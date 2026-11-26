import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@bowerbird/plugin-sdk/web'
import { openDialog } from '../../overlays/dialogs'
import { t } from '../../lib/i18n'
import { Btn, TextInput, type BtnVariant } from './ui'

/**
 * Dialogs for web-2 on top of the shell's `openDialog` host (overlays/dialogs.tsx, web-1).
 * Rules (copy.md 原则, E-07): buttons cancel-left / primary-right; destructive or access-widening primary in danger
 * colour; confirm-type dialogs are `alertdialog` and clicking outside cancels; forms and pickers are `dialog` and
 * clicking outside does NOT close.
 */

export interface DialogFrameProps {
  kind: 'confirm' | 'form'
  title: React.ReactNode
  text?: React.ReactNode
  wide?: boolean
  onDismiss(): void
  children?: React.ReactNode
  footer?: React.ReactNode
  /** Footer content on the left (e.g.「从磁盘选择其他文件…」). */
  footerStart?: React.ReactNode
}

export function DialogFrame(p: DialogFrameProps) {
  const [open, setOpen] = React.useState(true)
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); p.onDismiss() } }}>
      <DialogContent
        role={p.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        showCloseButton={false}
        dismissOnOutside={p.kind === 'confirm'}
        onInteractOutside={p.kind === 'form' ? e => e.preventDefault() : undefined}
        className="w2-dialog gap-3 rounded-[var(--radius-xl)] border-0 bg-surface-raised p-5 text-[13px] leading-[18px] text-ink-1 shadow-dialog"
        style={{ maxWidth: p.wide ? 560 : 440 }}
      >
        <DialogTitle className="text-[15px] font-semibold leading-5 text-ink-1">{p.title}</DialogTitle>
        {p.text ? <DialogDescription className="w2-dialog__text">{p.text}</DialogDescription> : <DialogDescription className="sr-only">{p.title}</DialogDescription>}
        {p.children}
        {(p.footer || p.footerStart) && (
          <div className="mt-1 flex items-center gap-2">
            {p.footerStart}
            <span className="flex-1" />
            {p.footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export interface Choice<T> { label: string; value: T; variant?: BtnVariant }

/** A confirm-type dialog with several outcomes (e.g. 取消 · 对调 · 没错，确认). Resolves undefined on cancel. */
export function choose<T>(o: { title: string; text?: React.ReactNode; body?: React.ReactNode; choices: Choice<T>[]; cancelLabel?: string; wide?: boolean }): Promise<T | undefined> {
  return openDialog<T>(close => (
    <DialogFrame kind="confirm" title={o.title} text={o.text} wide={o.wide} onDismiss={() => close()}
      footer={<>
        <Btn onClick={() => close()}>{o.cancelLabel ?? t('w2.common.cancel')}</Btn>
        {o.choices.map((c, i) => <Btn key={i} variant={c.variant} onClick={() => close(c.value)}>{c.label}</Btn>)}
      </>}>
      {o.body}
    </DialogFrame>
  ))
}

/** A one-field form dialog. `validate` returns an error message or null; empty input is invalid unless `allowEmpty`. */
export function promptText(o: { title: string; text?: React.ReactNode; initial?: string; placeholder?: string; label?: string; confirmLabel: string; danger?: boolean; hint?: React.ReactNode; allowEmpty?: boolean; validate?(v: string): string | null; selectAll?: boolean }): Promise<string | undefined> {
  return openDialog<string>(close => <PromptBody o={o} close={close} />)
}

function PromptBody({ o, close }: { o: Parameters<typeof promptText>[0]; close(v?: unknown): void }) {
  const [v, setV] = React.useState(o.initial ?? '')
  const [err, setErr] = React.useState<string | null>(null)
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { const el = ref.current; if (!el) return; el.focus(); if (o.selectAll) el.select() }, [o.selectAll])
  const submit = () => {
    const x = v.trim()
    if (!x && !o.allowEmpty) { setErr(''); ref.current?.focus(); return }
    const e = o.validate?.(x) ?? null
    if (e !== null) { setErr(e); ref.current?.focus(); return }
    close(x)
  }
  return (
    <DialogFrame kind="form" title={o.title} text={o.text} onDismiss={() => close()}
      footer={<>
        <Btn onClick={() => close()}>{t('w2.common.cancel')}</Btn>
        <Btn variant={o.danger ? 'danger' : 'primary'} onClick={submit}>{o.confirmLabel}</Btn>
      </>}>
      <div>
        <TextInput ref={ref} value={v} placeholder={o.placeholder} aria-label={o.label ?? o.title} invalid={err !== null}
          onChange={e => { setV(e.target.value); setErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
        {err ? <p className="w2-hint" data-level="error">{err}</p> : null}
        {o.hint}
      </div>
    </DialogFrame>
  )
}
