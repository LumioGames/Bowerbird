import * as React from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { AssetDetail, CompareMode, VersionView } from '@bowerbird/schema'
import type { CompareSide } from '@bowerbird/plugin-sdk/web'
import { cn } from '@bowerbird/plugin-sdk/web'
import { t, useLocale } from '../lib/i18n'
import { useLibrary, useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { AssetThumb } from '../components/AssetThumb'
import { IssueMark, ReviewMark, StageMark } from '../components/marks'
import { EmptyState } from '../components/EmptyState'
import { toast } from '../overlays/toast'
import { pickAsset } from '../shell/picker'
import { useInspectorTarget } from '../shell/inspector-target'
import { usePluginRegistry, createFileSource } from '../plugins/registry'
import { Btn, Grow, Mono, Seg, Skeleton } from '../pages/shared/ui'
import { Menu, type MenuEntry } from '../pages/shared/menu'
import { at, errText, who } from '../pages/shared/text'
import { overlayOpen, typing } from '../pages/shared/bridge'
import { useAsset, useInvalidate, useVersions } from '../pages/shared/queries'
import { ViewerHost } from '../detail/ViewerHost'
import { PluginView } from '../detail/PluginView'
import { confirmRestore } from '../versions/restore'
import { MODES, pickMode, resolveModes } from './modes'
import { deltaMode, techRows, type TechSide } from './tech'
import { WipeDivider } from './Wipe'
import { cut, useFit } from '../components/fit'

/** The steps a crowded compare bar takes, in order (components/fit.ts). */
const CFOLD = { marks: 1, modes: 2 } as const
/** A side picker's widest (web2.css .w2-cpk max-width). */
const PICKER_MAX = 260

type Key = 'a' | 'b'
interface Side { key: Key; asset: AssetDetail; versions: VersionView[]; version: VersionView; current: boolean }

/** `av` / `bv` accept a version number (1-based) or a content hash. */
export function versionOf(versions: VersionView[], spec: string | null): VersionView | undefined {
  if (!versions.length) return undefined
  const cur = versions.find(v => v.current) ?? versions[versions.length - 1]
  if (!spec) return cur
  if (/^\d+$/.test(spec)) return versions.find(v => v.n === Number(spec)) ?? cur
  return [...versions].reverse().find(v => v.hash === spec) ?? cur
}

function useSide(lib: string, key: Key, id: string | null, spec: string | null): { side: Side | null; pending: boolean; error: unknown } {
  const a = useAsset(lib, id)
  const v = useVersions(lib, id)
  if (!a.data || !v.data) return { side: null, pending: a.isPending || v.isPending, error: a.error ?? v.error }
  const versions = v.data.versions.length ? v.data.versions : a.data.versions.map((x, i, arr) => ({ ...x, n: i + 1, current: i === arr.length - 1, hasContent: i === arr.length - 1 }))
  const version = versionOf(versions, spec)!
  return { side: { key, asset: a.data, versions, version, current: !!version?.current }, pending: false, error: null }
}

/**
 * 对比页 `/libraries/:lib/compare?a=&b=&av=&bv=&mode=` (pages.md 对比页): two sides, each an asset or one of its
 * versions, each replaceable (another version / something related / search) and swappable; the modes the format
 * plugin offers for this pair; the shell's wipe divider; the technical information table; 恢复为当前版本… when both
 * sides are versions of one asset.
 */
export function ComparePage() {
  const locale = useLocale()
  const lib = useLibraryId()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const libInfo = useLibrary()
  const reg = usePluginRegistry()
  const inv = useInvalidate(lib)
  useInspectorTarget({ kind: 'none' }, [])
  const A = useSide(lib, 'a', params.get('a'), params.get('av'))
  const B = useSide(lib, 'b', params.get('b'), params.get('bv'))
  const [split, setSplit] = React.useState(0.5)
  const [pluginBar, setPluginBar] = React.useState<HTMLElement | null>(null)
  /* 技术信息 starts open, except for a model against an image (the sheet needs the room; compare.js infoMi); the
     choice is kept per kind of pair for this page */
  const [infoSet, setInfoSet] = React.useState<{ pair: boolean | null; mi: boolean | null }>({ pair: null, mi: null })

  const close = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }

  const resolved = A.side && B.side ? resolveModes(A.side.asset, B.side.asset, f => reg.formatView(f), { pair: t('cmp.why.pair'), notOffered: t('cmp.why.notOffered') }) : null
  const mode: CompareMode = resolved ? pickMode(resolved, params.get('mode')) : 'side'

  /* out of room (a narrow window, a longer language): the names keep as much as they can — the stage marks lose their
     words first, then the mode buttons show only their icons (components/fit.ts). A picker at its widest (260 px) that
     still cuts a long name is not short of room. */
  const fit = useFit<HTMLDivElement>(CFOLD.modes, el => cut(el) + [...el.querySelectorAll<HTMLElement>('.w2-cpk')].reduce((s, pk) => s + (pk.offsetWidth < PICKER_MAX - 1 ? cut(pk.querySelector('b')) : 0), 0),
    [locale, A.side?.asset.name, B.side?.asset.name, A.side?.version.n, B.side?.version.n, mode])
  const fold = (step: number) => fit.level >= step

  const keyRef = React.useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || typing(e) || overlayOpen()) return
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); close(); return }
    /* ← / → move the wipe divider only while its knob has focus (WipeDivider handles them); elsewhere they belong
       to whatever has focus — a video's timeline, a model's view */
  }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!params.get('a') || !params.get('b')) return <div className="w2-compare"><EmptyState icon="git-compare-arrows" title={t('cmp.needTwo')} /></div>
  if (A.error || B.error) return <div className="w2-compare"><div className="w2-cbar"><Btn variant="ghost" iconOnly icon="chevron-left" aria-label={t('common.back')} onClick={close} /></div><EmptyState icon="circle-alert" title={t('common.loadFailed')} body={errText(A.error ?? B.error)} /></div>
  if (!A.side || !B.side || !resolved) return <div className="w2-compare"><div className="w2-cbar" /><Skeleton rows={4} /></div>
  const a = A.side, b = B.side

  const sideOf = (s: Side, label: 'A' | 'B'): CompareSide => ({
    asset: s.asset,
    source: createFileSource(lib, s.asset, s.current ? null : s.version.hash),
    label,
    version: s.current ? null : s.version
  })
  const left = sideOf(a, 'A'), right = sideOf(b, 'B')
  const setMode = (m: CompareMode) => update({ mode: m })
  const swap = () => update({ a: params.get('b'), b: params.get('a'), av: params.get('bv'), bv: params.get('av') })

  /* restore: both sides are versions of one asset and at least one of them is an older one with content */
  const sameAsset = a.asset.id === b.asset.id
  const restorable = sameAsset && !!libInfo.data?.versionStore ? [a, b].filter((s, i, arr) => !s.current && s.version.hasContent && arr.findIndex(x => x.version.n === s.version.n) === i) : []
  const afterRestore = () => { inv.asset(a.asset.id); update({ av: null, bv: null }) }
  const restoreBtn = restorable.length === 1
    ? <Btn size="sm" icon="undo-2" onClick={() => void confirmRestore(lib, a.asset, a.versions, restorable[0]!.version.n, afterRestore)}>{t('cmp.restoreN', { n: restorable[0]!.version.n })}</Btn>
    : restorable.length > 1
      ? <Menu trigger={<Btn size="sm" icon="undo-2">{t('ver.restore')}<Icon name="chevron-down" size={12} /></Btn>}
          items={restorable.map(s => ({ icon: 'undo-2', label: t('cmp.restoreN', { n: s.version.n }), kbd: s.version.note, onSelect: () => void confirmRestore(lib, a.asset, a.versions, s.version.n, afterRestore) }))} />
      : null

  const modelImage = (a.asset.format === 'model' && b.asset.format === 'image') || (a.asset.format === 'image' && b.asset.format === 'model')
  const info = (modelImage ? infoSet.mi : infoSet.pair) ?? !modelImage
  const setInfo = (f: (v: boolean) => boolean) => setInfoSet(s => (modelImage ? { ...s, mi: f(info) } : { ...s, pair: f(info) }))
  const fvA = reg.formatView(a.asset.format), fvB = reg.formatView(b.asset.format)
  const labels = { ...(fvB?.view.techLabels ?? {}), ...(fvA?.view.techLabels ?? {}) }
  const techOf = (s: Side): TechSide => ({ tech: s.current ? s.asset.tech : {}, size: s.version.size, n: s.version.n })
  const dm = deltaMode(a.asset.id, b.asset.id, a.asset.format, b.asset.format)
  const rows = techRows(techOf(a), techOf(b), labels, dm, t('cmp.size'))
  const Compare = resolved.view?.Compare

  return (
    <div className="w2-compare">
      <div className="w2-cbar" ref={fit.ref}>
        <Btn variant="ghost" iconOnly icon="chevron-left" aria-label={t('common.back')} title={`${t('common.back')} Esc`} onClick={close} />
        <SidePicker lib={lib} side={a} other={b} onPick={(id, v) => update({ a: id, av: v })} compact={fold(CFOLD.marks)} />
        <Btn variant="ghost" iconOnly icon="arrow-up-down" className="w2-cswap" aria-label={t('cmp.swap')} title={t('cmp.swap')} onClick={swap} />
        <SidePicker lib={lib} side={b} other={a} onPick={(id, v) => update({ b: id, bv: v })} compact={fold(CFOLD.marks)} />
        <Grow />
        <Seg<CompareMode> label={t('cmp.modes')} anchor="cmp.modes" value={mode} onChange={setMode}
          onUnavailable={reason => toast({ title: reason })}
          items={MODES.map(m => {
            const r = resolved.modes.find(x => x.mode === m.mode)!
            const label = t(`cmp.mode.${m.mode}`)
            return { value: m.mode, icon: m.icon, label: fold(CFOLD.modes) ? <span className="sr-only">{label}</span> : label, title: fold(CFOLD.modes) ? label : undefined, unavailable: r.available ? undefined : r.reason ?? t('cmp.why.notOffered') }
          })} />
        <Grow />
        {/* the plugin compare view's own options go here (CompareProps.toolbar), before「技术信息」as in the prototype */}
        {Compare && <span ref={setPluginBar} className="contents" data-slot="compare-plugin-options" />}
        {restoreBtn}
        <Btn variant="ghost" iconOnly icon="list" aria-pressed={info} aria-label={t('cmp.info')} title={t('cmp.info')} onClick={() => setInfo(x => !x)} />
      </div>
      <div className={cn('w2-cstage', `w2-cstage--${mode}`)}>
        {Compare
          ? <div className="w2-cpanes"><div className="w2-cp">
              <PluginView lib={lib} pluginId={resolved.pluginId!} component={Compare} props={{ left, right, mode, split, toolbar: pluginBar }} assets={[a.asset, b.asset]} />
              {mode === 'wipe' && <WipeDivider value={split} onChange={setSplit} />}
            </div></div>
          : <div className="w2-cpanes">
              {[a, b].map((s, i) => (
                <div key={s.key + s.asset.id + s.version.n} className="w2-cp">
                  <span className="w2-clab w2-floating"><i className="w2-cpk__k">{i ? 'B' : 'A'}</i>{s.versions.length > 1 ? `v${s.version.n}${s.current ? ` · ${t('ver.current')}` : ''}` : s.asset.name}</span>
                  <ViewerHost lib={lib} asset={s.asset} mode="compare" versionHash={s.current ? null : s.version.hash} className="flex min-h-0 flex-1 flex-col" />
                </div>
              ))}
            </div>}
      </div>
      {info && (
        <div className="w2-ctab">
          <div className="w2-ct" role="table" aria-label={t('cmp.info')}>
            <div className="w2-ct__lab">{dm && <small>{t(dm === 'new-minus-old' ? 'cmp.newMinusOld' : 'cmp.bVsA')}</small>}</div>
            {[a, b].map((s, i) => (
              <div key={i} className="w2-ct__h">
                <i className="w2-cpk__k">{i ? 'B' : 'A'}</i><b>{s.asset.name}</b>
                {s.versions.length > 1 && <span className={cn('w2-cpk__v', s.current && 'w2-cpk__v--now')}>v{s.version.n}{s.current ? ` · ${t('ver.current')}` : ''}</span>}
                <small>{s.versions.length > 1 && s.version.note ? `${s.version.note} · ` : ''}<Mono>{who(s.version.by)}</Mono> · {at(s.version.at)}</small>
              </div>
            ))}
            {rows.map(r => (
              <React.Fragment key={r.key}>
                <div className="w2-ct__lab">{r.label}</div>
                <div className={cn('w2-ct__v', r.differs && 'w2-ct__v--d')} data-row={r.key} data-side="a">{r.a}{r.deltaOn === 'a' && <span className="w2-ct__dl">{r.delta}</span>}</div>
                <div className={cn('w2-ct__v', r.differs && 'w2-ct__v--d')} data-row={r.key} data-side="b">{r.b}{r.deltaOn === 'b' && <span className="w2-ct__dl">{r.delta}</span>}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One side's picker (components.md 对比页顶栏): thumbnail, name, issue / stage / review marks, version; the menu
 * offers its versions (those without content are disabled:「未保存」), related assets, or「其他资产…」(the picker).
 */
function SidePicker({ lib, side, other, onPick, compact }: { lib: string; side: Side; other: Side; onPick(id: string, version: string | null): void; compact?: boolean }) {
  const a = side.asset
  const items = (): MenuEntry[] => {
    const out: MenuEntry[] = []
    if (side.versions.length > 1) {
      out.push({ kind: 'label', label: t('cmp.versions') })
      for (const v of side.versions.slice().reverse()) {
        out.push({ label: `v${v.n} · ${v.note ?? ''}`, check: v.n === side.version.n, kbd: v.hasContent || v.current ? at(v.at) : t('cmp.unsaved'), disabled: !v.hasContent && !v.current, onSelect: () => onPick(a.id, v.current ? null : String(v.n)) })
      }
      out.push({ kind: 'sep' })
    }
    const seen = new Set([a.id])
    const rel: Array<{ id: string; name: string }> = []
    for (const r of [...a.relations.outgoing, ...a.relations.incoming]) {
      if (!r.target || seen.has(r.target.id)) continue
      seen.add(r.target.id); rel.push(r.target)
    }
    if (rel.length) {
      out.push({ kind: 'label', label: t('cmp.related') })
      for (const r of rel.slice(0, 8)) out.push({ icon: 'file', label: r.name, onSelect: () => onPick(r.id, null) })
      out.push({ kind: 'sep' })
    }
    out.push({ icon: 'search', label: t('cmp.other'), onSelect: () => { void pickAsset({ title: t('cmp.pickTitle'), exclude: [other.asset.id] }).then(p => { if (p) onPick(p.id, null) }) } })
    return out
  }
  return (
    <Menu trigger={
      <button type="button" className="w2-cpk" title={a.path}>
        <i className="w2-cpk__k">{side.key.toUpperCase()}</i>
        <span className="w2-thumb"><AssetThumb asset={a} size={24} fit="cover" /></span>
        <b>{a.name}</b>
        {a.issueLevel && <IssueMark level={a.issueLevel} count={a.issueCount} flags={a.flags} />}
        <StageMark stage={a.stage} size="sm" label={compact ? 'none' : 'short'} />
        {a.review !== 'exempt' && <ReviewMark review={a.review} size="sm" />}
        {side.versions.length > 1 && <span className={cn('w2-cpk__v', side.current && 'w2-cpk__v--now')}>v{side.version.n}</span>}
        <Icon name="chevron-down" size={12} />
      </button>
    } items={items} />
  )
}
