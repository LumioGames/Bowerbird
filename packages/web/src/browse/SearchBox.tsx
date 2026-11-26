import * as React from 'react'
import type { Filter, QueryChip } from '@bowerbird/schema'
import { cn, Kbd } from '@bowerbird/plugin-sdk/web'
import { Icon } from '../components/Icon'
import { t } from '../lib/i18n'
import { kbd } from '../lib/platform'
import { absorbTyped, chipsOf, removeChip, type BrowseState, type Extras } from './query'
import { applyCompletion, complete, type Completion, type CompletionSource } from './complete'

/**
 * The search box (search.md「文本语法」): conditions show as chips (`stage:runtime`) before the free words; typing
 * `key:value` and a space turns it into a chip; Backspace in an empty box removes the last chip; the filter panel
 * edits the same chips. Completion under the box offers keys (with their Chinese meaning) and the library's values.
 */
export interface SearchPatch { filter?: Filter; extras?: Extras; text?: string }

const PARTIAL_KEY = /(^|\s)-?[a-zA-Z]+:[^\s]*$/

export function SearchBox({ state, onCommit, source, inputRef, narrow }: {
  state: BrowseState
  onCommit: (patch: SearchPatch, opts?: { push?: boolean }) => void
  source: CompletionSource
  inputRef?: React.Ref<HTMLInputElement>
  /** The tool bar is out of room: the box may get narrower than its usual 180 px. */
  narrow?: boolean
}) {
  const [input, setInput] = React.useState(state.text)
  const committed = React.useRef(state.text)
  const own = React.useRef<HTMLInputElement | null>(null)
  React.useImperativeHandle(inputRef, () => own.current!, [])
  const [ac, setAc] = React.useState<{ items: Completion[]; start: number; end: number; i: number } | null>(null)
  // combobox semantics: the box owns the completion list and points at the highlighted option
  const listId = React.useId()
  const optId = (i: number) => `${listId}-o${i}`
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // The address changed from elsewhere (back/forward, a chip removed in the panel, 清空): follow it.
  React.useEffect(() => {
    if (state.text !== committed.current) { committed.current = state.text; setInput(state.text) }
  }, [state.text])

  /** A word typed a moment ago waits 220 ms before it is searched; anything committed sooner replaces it. */
  const cancelPending = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  React.useEffect(() => cancelPending, [])

  const commitText = (v: string, now = false) => {
    const text = v.replace(PARTIAL_KEY, '').trim()
    cancelPending()
    const send = () => { if (text !== committed.current) { committed.current = text; onCommit({ text }) } }
    if (now) send(); else timer.current = setTimeout(send, 220)
  }

  const refreshAc = (v: string, caret: number) => {
    const r = complete(v, caret, source)
    setAc(r.items.length ? { ...r, i: 0 } : null)
  }

  const onChange = (v: string, caret: number) => {
    const r = absorbTyped(state, v, false)
    if (r.changed) {
      cancelPending()
      setInput(r.input)
      committed.current = r.input.replace(PARTIAL_KEY, '').trim()
      onCommit({ filter: r.filter, extras: r.extras, text: committed.current })
      setAc(null)
      return
    }
    setInput(v)
    commitText(v)
    refreshAc(v, caret)
  }

  const take = (c: Completion) => {
    if (!ac) return
    const { text, caret } = applyCompletion(input, c, ac.start, ac.end)
    // the half-typed word must not be searched after the completion replaced it
    cancelPending()
    if (c.done) {
      const r = absorbTyped(state, text, false)
      setInput(r.input)
      committed.current = r.input.replace(PARTIAL_KEY, '').trim()
      onCommit({ filter: r.filter, extras: r.extras, text: committed.current })
      setAc(null)
      requestAnimationFrame(() => own.current?.focus())
    } else {
      setInput(text)
      requestAnimationFrame(() => { own.current?.setSelectionRange(caret, caret); refreshAc(text, caret) })
    }
  }

  const chips = chipsOf(state)
  const drop = (c: QueryChip) => { cancelPending(); onCommit({ ...removeChip(state, c), text: input.replace(PARTIAL_KEY, '').trim() }) }

  return (
    // in a crowded bar the box gives way before the path does (its shrink factor dwarfs the path's 1)
    <div className={cn('relative flex-[0_1_300px] ![flex-shrink:1000]', narrow ? 'min-w-[128px]' : 'min-w-[180px]')}>
      <div
        onClick={() => own.current?.focus()}
        className="bb-no-scrollbar flex h-7 min-w-0 cursor-text items-center gap-1.5 overflow-x-auto rounded-sm bg-fill-rest px-2 text-ink-1 transition-colors duration-fade hover:bg-fill-hover focus-within:bg-fill-rest focus-within:outline-2 focus-within:outline-accent-ring"
      >
        <Icon name="search" className="shrink-0 text-ink-2" />
        {chips.map((c, i) => (
          <span key={`${c.key}:${c.value}:${i}`} className="inline-flex h-5 shrink-0 items-center rounded-xs bg-fill-hover px-1.5 font-mono text-[12px] leading-4 whitespace-nowrap">
            <span className="text-ink-2">{c.key}:</span>{c.value}
            <button type="button" aria-label={t('bar.removeCond')} onClick={e => { e.stopPropagation(); drop(c) }}
              className="ml-1 inline-flex cursor-default border-0 bg-transparent p-0 text-ink-2 hover:text-ink-1"><Icon name="x" size={12} /></button>
          </span>
        ))}
        <input
          ref={own}
          value={input}
          placeholder={chips.length ? '' : t('bar.search')}
          aria-label={t('bar.search')}
          role="combobox"
          aria-expanded={!!ac}
          aria-controls={ac ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={ac ? optId(ac.i) : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={e => onChange(e.target.value, e.target.selectionEnd ?? e.target.value.length)}
          onBlur={() => setTimeout(() => setAc(null), 120)}
          onKeyDown={e => {
            if (ac) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, i: (ac.i + (e.key === 'ArrowDown' ? 1 : ac.items.length - 1)) % ac.items.length }); return }
              if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); take(ac.items[ac.i]!); return }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAc(null); return }
            }
            if (e.key === 'Enter') {
              cancelPending()
              const r = absorbTyped(state, input, true)
              setInput(r.input)
              committed.current = r.input.trim()
              onCommit({ filter: r.filter, extras: r.extras, text: committed.current })
              return
            }
            if (e.key === 'Backspace' && !input && chips.length) { e.preventDefault(); drop(chips[chips.length - 1]!); return }
            if (e.key === 'Escape') { e.preventDefault(); own.current?.blur() }
          }}
          className="h-full min-w-16 flex-1 border-0 bg-transparent p-0 text-ink-1 outline-none placeholder:text-ink-3"
        />
        <span className={cn('flex shrink-0 gap-0.5', narrow && 'hidden')}>{kbd('mod+F').split(/(?<=⌘)|\+/).filter(Boolean).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
      </div>
      {ac && (
        <div role="listbox" id={listId} aria-label={t('bar.search')} className="absolute top-[calc(100%+4px)] left-0 z-[60] max-w-[420px] min-w-full rounded-md bg-surface-raised p-1 shadow-popover">
          {ac.items.map((c, i) => (
            <div key={c.insert} id={optId(i)} role="option" aria-selected={i === ac.i}
              onMouseDown={e => { e.preventDefault(); take(c) }}
              className={cn('flex h-7 cursor-default items-center justify-between gap-4 rounded-sm px-2 text-ink-1 hover:bg-fill-hover', i === ac.i && 'bg-accent-soft hover:bg-accent-soft')}>
              <span className="font-mono text-[11px]">{c.label}</span>
              <span className="text-[12px] text-ink-3">{c.detail}</span>
            </div>
          ))}
          <div role="presentation" aria-hidden className="px-2 pt-1 pb-0.5 text-[11px] text-ink-3">{t('ac.hint')}</div>
        </div>
      )}
    </div>
  )
}
