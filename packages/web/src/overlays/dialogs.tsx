import * as React from 'react'
import type { ConfirmOptions } from '@bowerbird/plugin-sdk/web'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
  Button, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle
} from '@bowerbird/plugin-sdk/web'
import { Icon } from '../components/Icon'
import { t } from '../lib/i18n'

/**
 * Centered dialogs (copy.md 原则): confirm-type = alertdialog, click outside = cancel; forms and pickers = dialog,
 * click outside does NOT close (E-07). Buttons: cancel left, primary right, danger colour for destructive actions.
 * Owner: line web-1. `DialogHost` is mounted once by ShellLayout.
 */
export type DialogRender = (close: (result?: unknown) => void) => React.ReactNode

let push: ((d: { render: DialogRender; resolve: (v: unknown) => void }) => void) | null = null

/** Open any dialog; resolves with what `close(result)` was given (undefined when dismissed). */
export function openDialog<T = unknown>(render: DialogRender): Promise<T | undefined> {
  return new Promise(resolve => {
    if (!push) { resolve(undefined); return }
    push({ render, resolve: v => resolve(v as T | undefined) })
  })
}

/** Confirm dialog; resolves true when the primary button was chosen. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return confirmImpl(opts)
}
let confirmImpl: (opts: ConfirmOptions) => Promise<boolean> = async opts =>
  (await openDialog<boolean>(close => <ConfirmDialog {...opts} onDone={ok => close(ok)} />)) === true
export function setConfirmImpl(fn: (opts: ConfirmOptions) => Promise<boolean>): void { confirmImpl = fn }

export function DialogHost() {
  const [stack, setStack] = React.useState<Array<{ id: number; render: DialogRender; resolve: (v: unknown) => void }>>([])
  React.useEffect(() => {
    let n = 0
    push = d => setStack(s => [...s, { id: ++n, ...d }])
    return () => { push = null }
  }, [])
  return (
    <>
      {stack.map(d => (
        <React.Fragment key={d.id}>
          {d.render(result => { d.resolve(result); setStack(s => s.filter(x => x.id !== d.id)) })}
        </React.Fragment>
      ))}
    </>
  )
}

/**
 * The confirmation every destructive or decisive action asks (delete, trash a folder, delete a smart folder…).
 * Click outside = cancel. Optional `children` go under the text (e.g. the list of referrers).
 */
export function ConfirmDialog(p: ConfirmOptions & { onDone: (ok: boolean) => void; children?: React.ReactNode; icon?: string; extraActions?: Array<{ label: string; onClick: () => void; variant?: 'default' | 'danger' | 'primary' | 'ghost' }> }) {
  const done = React.useRef(false)
  const finish = (ok: boolean) => { if (done.current) return; done.current = true; p.onDone(ok) }
  return (
    <AlertDialog open onOpenChange={open => { if (!open) finish(false) }}>
      <AlertDialogContent onOverlayClick={() => finish(false)} size={p.children ? 'wide' : 'default'}>
        <AlertDialogTitle>{p.title}</AlertDialogTitle>
        {p.body != null && <AlertDialogDescription asChild={typeof p.body !== 'string'}>{typeof p.body === 'string' ? p.body : <div>{p.body}</div>}</AlertDialogDescription>}
        {p.children != null && <div className="mt-4">{p.children}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>{p.cancelLabel ?? t('common.cancel')}</AlertDialogCancel>
          {p.extraActions?.map((a, i) => (
            <Button key={i} size="lg" variant={a.variant ?? 'default'} onClick={() => { done.current = true; a.onClick() }}>{a.label}</Button>
          ))}
          <Button size="lg" variant={p.danger ? 'danger' : 'primary'} autoFocus onClick={() => finish(true)}>
            {p.icon && <Icon name={p.icon} />}{p.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * A form or picker dialog: does not close on a stray click outside; Esc and「取消」close it.
 * `footLeft` is the secondary content at the bottom left (「添加资产库…」「Forge 提供」, a checkbox).
 */
export function FormDialog(p: {
  title: React.ReactNode
  description?: React.ReactNode
  size?: 'default' | 'wide'
  children?: React.ReactNode
  footLeft?: React.ReactNode
  /** The buttons right of `footLeft`; when omitted, cancel + `primary`. */
  actions?: React.ReactNode
  primary?: { label: React.ReactNode; icon?: string; onClick: () => void; disabled?: boolean; danger?: boolean }
  cancelLabel?: string
  onClose: () => void
  className?: string
  /** Called on Enter in a single-line input inside the body (submits like the primary button). */
  submitOnEnter?: boolean
}) {
  return (
    <Dialog open onOpenChange={open => { if (!open) p.onClose() }}>
      <DialogContent size={p.size} className={p.className} aria-describedby={undefined}
        onKeyDown={e => {
          if (p.submitOnEnter && e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && p.primary && !p.primary.disabled) { e.preventDefault(); p.primary.onClick() }
        }}>
        <DialogTitle>{p.title}</DialogTitle>
        {p.description != null && <DialogDescription>{p.description}</DialogDescription>}
        {p.children != null && <DialogBody>{p.children}</DialogBody>}
        <DialogFooter>
          {p.footLeft != null && <div className="mr-auto flex min-w-0 items-center gap-2 text-[12px] text-ink-2">{p.footLeft}</div>}
          {p.actions ?? (
            <>
              <Button size="lg" variant="ghost" onClick={p.onClose}>{p.cancelLabel ?? t('common.cancel')}</Button>
              {p.primary && (
                <Button size="lg" variant={p.primary.danger ? 'danger' : 'primary'} disabled={p.primary.disabled} onClick={p.primary.onClick}>
                  {p.primary.icon && <Icon name={p.primary.icon} />}{p.primary.label}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A well-coloured list inside a dialog (referrers, files to export). */
export function DialogList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('max-h-[172px] overflow-auto rounded-md bg-surface-well p-1', className)}>{children}</div>
}

/** A one-or-two field name dialog (new folder, rename…). Resolves with the trimmed values, or undefined. */
export function promptNames(o: {
  title: string
  fields: Array<{ label: string; value?: string; hint?: string; placeholder?: string }>
  okLabel: string
  validate?: (values: string[]) => string | null
}): Promise<string[] | undefined> {
  return openDialog<string[]>(close => <NameDialog {...o} onDone={v => close(v)} />)
}

function NameDialog(o: Parameters<typeof promptNames>[0] & { onDone: (v?: string[]) => void }) {
  const [values, setValues] = React.useState(o.fields.map(f => f.value ?? ''))
  const [error, setError] = React.useState<string | null>(null)
  const first = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => { first.current?.focus(); first.current?.select() }, [])
  const submit = () => {
    const v = values.map(x => x.trim())
    const err = o.validate?.(v) ?? null
    if (err) { setError(err); first.current?.focus(); return }
    o.onDone(v)
  }
  return (
    <FormDialog title={o.title} onClose={() => o.onDone()} primary={{ label: o.okLabel, onClick: submit }} submitOnEnter>
      {o.fields.map((f, i) => (
        <div key={i}>
          <label className={cn('mb-1 block text-[12px] font-semibold text-ink-2', i > 0 && 'mt-3')}>{f.label}</label>
          <div data-invalid={(i === 0 && error) || undefined} className="flex h-7 items-center rounded-sm bg-fill-rest px-2 hover:bg-fill-hover focus-within:outline-2 focus-within:outline-accent-ring data-[invalid]:shadow-[inset_0_0_0_1px_var(--danger-ink)]">
            <input
              ref={i === 0 ? first : undefined}
              value={values[i]}
              placeholder={f.placeholder}
              aria-label={f.label}
              autoComplete="off"
              onChange={e => { const next = [...values]; next[i] = e.target.value; setValues(next); if (i === 0) setError(null) }}
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ink-1 outline-none placeholder:text-ink-3"
            />
          </div>
          {i === 0 && error && <p className="m-0 mt-1 text-[11px] leading-[14px] text-danger-ink">{error}</p>}
          {f.hint && <p className="m-0 mt-1.5 text-[12px] leading-4 text-ink-3">{f.hint}</p>}
        </div>
      ))}
    </FormDialog>
  )
}
