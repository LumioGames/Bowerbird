import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { TagInfo } from '@bowerbird/schema'
import { cn } from '@bowerbird/plugin-sdk/web'
import { api } from '../lib/api'
import { t, useLocale } from '../lib/i18n'
import { useLibraryId } from '../lib/library'
import { Icon } from '../components/Icon'
import { PageFrame } from '../components/PageFrame'
import { confirm } from '../overlays/dialogs'
import { toast } from '../overlays/toast'
import { useInspectorTarget } from '../shell/inspector-target'
import { Btn, Grow, Num, Seg, Tag } from './shared/ui'
import { Menu, type MenuEntry } from './shared/menu'
import { promptText } from './shared/dialogs'
import { errText } from './shared/text'
import { useTags } from './shared/queries'

type Sort = 'name' | 'count'
/** Tags used by this few assets get the warning colour (likely typos to merge). */
export const FEW = 2

export function sortTags(tags: TagInfo[], sort: Sort): TagInfo[] {
  return tags.slice().sort((a, b) => (sort === 'count' ? a.count - b.count || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)))
}

/**
 * 标签 `/tags` (pages.md 标签): groups (drag a tag into one), colour (a 6px dot only), aliases, counts; 改名 (shows how
 * many assets, the old name stays as an alias, undoable), 合并 (not undoable), sort by least used; AI tags nobody
 * adopted yet (采纳 / 全部采纳 / 全部移除); empty state.
 */
export function TagsPage() {
  useLocale()
  const lib = useLibraryId()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const q = useTags(lib)
  const [sort, setSort] = React.useState<Sort>('name')
  const [drag, setDrag] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<string | null>(null)
  useInspectorTarget({ kind: 'none' }, [])
  const back = () => { if (location.key !== 'default') navigate(-1); else navigate(`/libraries/${encodeURIComponent(lib)}`) }
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['lib', lib] }) }
  const human = (q.data?.tags ?? []).filter(x => x.count > 0)
  const ai = (q.data?.tags ?? []).filter(x => x.aiCount > 0).sort((a, b) => b.aiCount - a.aiCount)
  const groups = q.data?.groups ?? []
  const list = sortTags(human, sort)

  const patch = async (body: Parameters<typeof api.tags.patch>[1]) => { const r = await api.tags.patch(lib, body); refresh(); return r }
  const rename = async (tag: TagInfo) => {
    const to = await promptText({ title: t('tags.rename.title', { tag: tag.name }), text: t('tags.rename.text', { n: tag.count }), initial: tag.name, confirmLabel: t('tags.rename.confirm'), label: t('tags.rename.label'), selectAll: true,
      validate: v => (v !== tag.name && human.some(x => x.name === v) ? t('tags.rename.exists') : null) })
    if (!to || to === tag.name) return
    try {
      const r = await patch({ rename: { from: tag.name, to } })
      toast({ kind: 'success', title: t('tags.renamed', { n: r.affected }), undo: async () => { await patch({ rename: { from: to, to: tag.name } }) } })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const merge = async (from: TagInfo, into: TagInfo) => {
    const ok = await confirm({ title: t('tags.merge.title', { a: from.name, b: into.name }), body: t('tags.merge.text', { n: from.count, a: from.name, b: into.name }), confirmLabel: t('tags.merge.confirm'), danger: true })
    if (!ok) return
    try { const r = await patch({ merge: { from: from.name, into: into.name } }); toast({ kind: 'success', title: t('tags.merged', { n: r.affected }) }) }
    catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  /* `group: ''` takes the tag out of its group (PATCH /tags define: an omitted group means "leave it as it is") */
  const moveTo = async (tag: TagInfo, group: string) => {
    const was = tag.group ?? ''
    if (was === group) return
    try {
      await patch({ define: { name: tag.name, group, color: tag.color, aliases: tag.aliases } })
      toast({ title: t('tags.moved', { tag: tag.name, group: group || t('tags.ungrouped') }), undo: async () => { await patch({ define: { name: tag.name, group: was, color: tag.color, aliases: tag.aliases } }) } })
    } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const newGroup = async () => {
    const name = await promptText({ title: t('tags.newGroup'), confirmLabel: t('tags.newGroupConfirm'), label: t('tags.groupName'), initial: t('tags.groupDefault', { n: groups.length + 1 }), selectAll: true,
      validate: v => (groups.includes(v) ? t('tags.groupExists') : null) })
    if (!name) return
    try { await patch({ groups: [...groups, name] }) } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const adopt = async (tag: TagInfo) => {
    try { const r = await api.tags.accept(lib, { tag: tag.name }); refresh(); toast({ kind: 'success', title: t('tags.adopted', { tag: tag.name, n: r.affected }) }) }
    catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const adoptAll = async () => {
    try { await api.tags.accept(lib, { all: true }); refresh(); toast({ kind: 'success', title: t('tags.adoptedAll', { n: ai.length }) }) }
    catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const dropAll = async () => {
    const ok = await confirm({ title: t('tags.dropAll.title', { n: ai.length }), body: t('tags.dropAll.text'), confirmLabel: t('tags.dropAll.confirm'), danger: true })
    if (!ok) return
    try { await api.tags.dismiss(lib, { all: true }); refresh() } catch (e) { toast({ kind: 'error', title: errText(e) }) }
  }
  const moreItems = (tag: TagInfo): MenuEntry[] => [
    { icon: 'pencil', label: t('tags.renameMore'), onSelect: () => void rename(tag) },
    { icon: 'git-compare-arrows', label: t('tags.mergeMore'), sub: [{ kind: 'label', label: t('tags.mergeInto', { tag: tag.name }) }, ...human.filter(x => x.name !== tag.name).slice(0, 30).map(x => ({ label: x.name, kbd: String(x.count), onSelect: () => void merge(tag, x) }))] },
    { icon: 'folder-input', label: t('tags.toGroup'), sub: [...groups, ''].map(g => ({ label: g || t('tags.ungrouped'), check: (tag.group ?? '') === g, onSelect: () => void moveTo(tag, g) })) }
  ]

  const sections = [...groups, ''].map(g => ({ g, tags: list.filter(x => (x.group ?? '') === g || (g === '' && x.group && !groups.includes(x.group))) }))
  const empty = !q.isPending && !q.isError && human.length === 0 && ai.length === 0
  return (
    <PageFrame
      title={t('tags.title')}
      subtitle={human.length ? t('tags.count', { n: human.length }) : undefined}
      onBack={back}
      state={q.isPending ? 'loading' : q.isError ? 'error' : empty ? 'empty' : 'ready'}
      onRetry={() => void q.refetch()}
      empty={{ icon: 'tags', title: t('tags.emptyTitle'), body: t('tags.emptyText') }}
      actions={human.length ? <>
        <Seg<Sort> label={t('tags.sort')} value={sort} onChange={setSort} items={[{ value: 'name', label: t('tags.sort.name') }, { value: 'count', label: t('tags.sort.count') }]} />
        <Btn size="sm" icon="plus" onClick={() => void newGroup()}>{t('tags.newGroup')}</Btn>
      </> : undefined}
    >
      <div className="w2-tg">
        {human.length > 0 && sections.map(({ g, tags }) => (
          <section key={g || '_'} className={cn('w2-tg__grp', over === g && drag && 'over')} data-group={g}
            onDragOver={e => { if (!drag) return; e.preventDefault(); setOver(g) }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(o => (o === g ? null : o)) }}
            onDrop={e => { e.preventDefault(); const tag = human.find(x => x.name === drag); setDrag(null); setOver(null); if (tag) void moveTo(tag, g) }}>
            <h5>{g || t('tags.ungrouped')}<span>{tags.length}</span></h5>
            {tags.map(tag => (
              <div key={tag.name} className="w2-tg__r" draggable data-tag={tag.name}
                onDragStart={e => { setDrag(tag.name); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', tag.name) } catch { /* some browsers */ } }}
                onDragEnd={() => { setDrag(null); setOver(null) }}>
                <i className="w2-tg__c" style={tag.color ? { background: tag.color } : undefined} />
                <b>{tag.name}</b>
                {tag.aliases?.length ? <small>{t('tags.aliases', { list: tag.aliases.join('、') })}</small> : null}
                <Grow />
                <Num className={cn(tag.count <= FEW && 'w2-tg__few')}>{tag.count}</Num>
                <Menu align="end" trigger={<Btn size="sm" variant="ghost" iconOnly icon="ellipsis" aria-label={t('tags.more', { tag: tag.name })} />} items={() => moreItems(tag)} />
              </div>
            ))}
          </section>
        ))}
        {ai.length > 0 && (
          <section className="w2-tg__ai">
            <h5><Icon name="sparkles" size={12} />{t('tags.aiTitle')}<span className="w2-rq__n">{ai.length}</span><Grow />
              <Btn size="sm" onClick={() => void dropAll()}>{t('tags.dropAllMore')}</Btn>
              <Btn size="sm" variant="primary" onClick={() => void adoptAll()}>{t('tags.adoptAll')}</Btn>
            </h5>
            <div className="w2-tags">
              {ai.map(tag => (
                <Tag key={tag.name} ai>{tag.name}<small>{tag.aiCount}</small>
                  <button type="button" aria-label={t('rq.adopt', { tag: tag.name })} title={t('tags.adoptTip')} onClick={() => void adopt(tag)}><Icon name="check" size={12} /></button>
                </Tag>
              ))}
            </div>
          </section>
        )}
      </div>
    </PageFrame>
  )
}
