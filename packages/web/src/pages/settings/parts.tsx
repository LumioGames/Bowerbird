import * as React from 'react'
import { cn } from '@bowerbird/plugin-sdk/web'
import { t } from '../../lib/i18n'
import { toast } from '../../overlays/toast'
import { Btn } from '../shared/ui'
import { errText } from '../shared/text'

/** Settings card parts (components.md 设置卡片): rows with name, control, note and where it is stored. */

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('w2-st__card', className)}>{children}</section>
}

export function Row({ k, children, note, error, scope, id }: { k: React.ReactNode; children: React.ReactNode; note?: React.ReactNode; error?: string | null; scope?: 'library' | 'machine'; id?: string }) {
  return (
    <div className="w2-st__row" data-row={id}>
      <span>{k}</span>
      <span className="w2-st__v">{children}{scope && <span className="w2-st__scope">{t(scope === 'library' ? 'set.scope.library' : 'set.scope.machine')}</span>}</span>
      {error ? <small className="w2-st__note" data-level="error" role="alert">{error}</small> : note ? <small className="w2-st__note">{note}</small> : null}
    </div>
  )
}

export function Heading({ title, sub, icon, children }: { title: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; children?: React.ReactNode }) {
  return <h2>{icon}{title}{sub && <small>{sub}</small>}{children}</h2>
}

export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast({ title: t('set.copied') }) }
  catch { toast({ kind: 'warning', title: t('set.copyFailed') }) }
}

export function Code({ text, label }: { text: string; label: string }) {
  return (
    <div className="w2-st__code">
      <pre aria-label={label}>{text}</pre>
      <Btn size="sm" variant="ghost" icon="copy" onClick={() => void copyText(text)}>{t('set.copy')}</Btn>
    </div>
  )
}

/**
 * A text / number field saved on blur or Enter (pages.md「缺的状态」: each input validates and shows a save failure).
 * `validate` returns an error message or null; `save` may throw — its message is shown under the row.
 */
export function SavedInput({ value, save, validate, className, ariaLabel, placeholder, type = 'text', inputMode }: {
  value: string
  save(v: string): Promise<unknown>
  validate?(v: string): string | null
  className?: string
  ariaLabel: string
  placeholder?: string
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  const [v, setV] = React.useState(value)
  const [err, setErr] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => { setV(value) }, [value])
  const commit = async () => {
    if (v === value) { setErr(null); return }
    const e = validate?.(v) ?? null
    if (e) { setErr(e); return }
    setSaving(true)
    try { await save(v); setErr(null) }
    catch (x) { const m = t('set.saveFailed', { reason: errText(x) }); setErr(m); toast({ kind: 'error', title: m }) }
    finally { setSaving(false) }
  }
  return (
    <>
      <input className={cn('w2-st__in', className)} value={v} type={type} inputMode={inputMode} aria-label={ariaLabel} placeholder={placeholder} aria-invalid={err ? true : undefined} disabled={saving}
        onChange={e => { setV(e.target.value); if (err) setErr(validate?.(e.target.value) ?? null) }}
        onBlur={() => void commit()}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit() } if (e.key === 'Escape') { setV(value); setErr(null) } }} />
      <FieldError msg={err} />
    </>
  )
}

/** Error line rendered by SavedInput into the row's note slot (a sibling portal-free approach: shown inline). */
function FieldError({ msg }: { msg: string | null }) {
  return msg ? <small className="w2-st__note w-full" data-level="error" role="alert">{msg}</small> : null
}

/** Integer validator for ranges like 回收站保留 1–3650 天 or 端口 1–65535. */
export function intIn(min: number, max: number) {
  return (v: string) => (/^\d+$/.test(v.trim()) && +v >= min && +v <= max ? null : t('set.intRange', { min, max }))
}
