import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateFor } from './events'
import { matchShortcut } from './shortcuts'
import { clearUndo, pushUndo, runUndo, undoDepth, undoLast } from './undo'

describe('shortcuts: Space and Enter on a focused control press it', () => {
  it('buttons, links, tabs, switches, menu items and tree rows keep Space / Enter; asset cells and plain elements do not', async () => {
    const { isActivationTarget } = await import('./shortcuts')
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild as HTMLElement }
    expect(isActivationTarget(el('<button>x</button>'))).toBe(true)
    expect(isActivationTarget(el('<a href="#">x</a>'))).toBe(true)
    expect(isActivationTarget(el('<a>x</a>'))).toBe(false)
    expect(isActivationTarget(el('<summary>x</summary>'))).toBe(true)
    for (const role of ['button', 'menuitem', 'tab', 'switch', 'checkbox', 'slider', 'treeitem', 'option']) expect(isActivationTarget(el(`<div role="${role}">x</div>`))).toBe(true)
    expect(isActivationTarget(el('<div role="option" data-asset-cell="a">x</div>'))).toBe(false)
    expect(isActivationTarget(el('<div tabindex="0">x</div>'))).toBe(false)
    expect(isActivationTarget(null)).toBe(false)
  })

  it('a page shortcut on Space does not fire while a button has focus', async () => {
    const React = await import('react')
    const { render, cleanup } = await import('@testing-library/react')
    const { useShortcut } = await import('./shortcuts')
    let fired = 0
    function T() { useShortcut('space', () => { fired++ }); return React.createElement('button', { id: 'b' }, 'x') }
    render(React.createElement(T))
    const b = document.getElementById('b')!
    b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    expect(fired).toBe(0)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    expect(fired).toBe(1)
    cleanup()
  })
})

describe('actor: who is me', () => {
  it('compares with the decoded name the server writes, not the percent-encoded header', async () => {
    const { currentActor, isMe, setActorName } = await import('./actor')
    setActorName('林')
    expect(currentActor()).toBe('user:%E6%9E%97')
    expect(isMe('user:林')).toBe(true)
    expect(isMe('user:%E6%9E%97')).toBe(true)
    expect(isMe('user:lin')).toBe(false)
    expect(isMe(null)).toBe(false)
    setActorName('')
    expect(isMe('user:unnamed')).toBe(true)
    expect(isMe('user:林')).toBe(false)
  })
})

describe('events: merged invalidation and reconnect', () => {
  it('a burst of events invalidates each key once per 100 ms', async () => {
    vi.useFakeTimers()
    try {
      const { createInvalidationBatcher } = await import('./events')
      const qc = new QueryClient()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      const b = createInvalidationBatcher(qc, 100)
      for (let i = 0; i < 50; i++) invalidateFor(b, 'L', 'asset.created', { id: `a${i}`, path: 'x' })
      expect(spy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      const keys = spy.mock.calls.map(c => JSON.stringify(c[0]))
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter(k => k.includes('"folders"'))).toHaveLength(1)
      b.dispose()
    } finally { vi.useRealTimers() }
  })

  it('after the stream reconnects, the library is fetched again', async () => {
    const React = await import('react')
    const { render, cleanup } = await import('@testing-library/react')
    const { QueryClientProvider } = await import('@tanstack/react-query')
    const { setEventSourceFactory, useLibraryEvents } = await import('./events')
    const listeners = new Map<string, Array<(ev: MessageEvent) => void>>()
    setEventSourceFactory(() => ({ addEventListener: (t, l) => { listeners.set(t, [...(listeners.get(t) ?? []), l]) }, close() {} }))
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    function T() { useLibraryEvents('L'); return null }
    render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(T)))
    const open = () => listeners.get('open')!.forEach(l => l(new MessageEvent('open')))
    open()
    expect(spy).not.toHaveBeenCalled()
    open()
    expect(spy).toHaveBeenCalledWith({ queryKey: ['lib', 'L'] })
    cleanup()
  })
})

describe('events: cache invalidation', () => {
  it('a scan that ends refreshes the library counts, folders, views and facets; while it runs only the counts', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const keys = () => spy.mock.calls.map(c => ((c[0] as { queryKey: unknown[] }).queryKey.slice(2)).join('/'))
    invalidateFor(qc, 'L', 'scan.progress', { running: true, phase: 'registering', done: 3, total: 9 })
    expect(keys()).toEqual(['info'])
    spy.mockClear()
    invalidateFor(qc, 'L', 'scan.progress', { running: false, phase: 'done', done: 9, total: 9 })
    expect(keys()).toEqual(expect.arrayContaining(['info', 'folders', 'views', 'vocabulary', 'browse', 'browse-facets']))
  })
})

const key = (k: string, o: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; code: string }> = {}) =>
  ({ key: k, code: o.code, metaKey: !!o.meta, ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift })

describe('shortcuts: Mac ⌘ / Windows Ctrl', () => {
  it('mod means ⌘ on Mac and Ctrl elsewhere', () => {
    expect(matchShortcut(key('z', { meta: true }), 'mod+z', true)).toBe(true)
    expect(matchShortcut(key('z', { ctrl: true }), 'mod+z', true)).toBe(false)
    expect(matchShortcut(key('z', { ctrl: true }), 'mod+z', false)).toBe(true)
    expect(matchShortcut(key('z', { meta: true }), 'mod+z', false)).toBe(false)
  })
  it('⇧⌘Z is not ⌘Z', () => {
    expect(matchShortcut(key('Z', { meta: true, shift: true }), 'mod+z', true)).toBe(false)
  })
  it('⌥⌘R uses the physical key when ⌥ composes a character', () => {
    expect(matchShortcut(key('®', { meta: true, alt: true, code: 'KeyR' }), 'mod+alt+r', true)).toBe(true)
    expect(matchShortcut(key('r', { ctrl: true, alt: true, code: 'KeyR' }), 'mod+alt+r', false)).toBe(true)
  })
  it('single keys: only Space and Delete', () => {
    expect(matchShortcut(key(' ', { code: 'Space' }), 'space', true)).toBe(true)
    expect(matchShortcut(key('Backspace'), 'del', true)).toBe(true)
    expect(matchShortcut(key('Delete'), 'del', false)).toBe(true)
    expect(matchShortcut(key(' ', { meta: true }), 'space', true)).toBe(false)
  })
})

describe('session undo', () => {
  afterEach(() => clearUndo())
  it('undoes the latest first, and an undone entry is gone', async () => {
    const order: string[] = []
    pushUndo({ label: 'a', undo: () => { order.push('a') } })
    pushUndo({ label: 'b', undo: () => { order.push('b') } })
    await undoLast()
    expect(order).toEqual(['b'])
    expect(undoDepth()).toBe(1)
    await undoLast()
    expect(await undoLast()).toBeNull()
    expect(order).toEqual(['b', 'a'])
  })
  it('the toast button takes its entry off the stack', async () => {
    const fn = vi.fn()
    const dismiss = vi.fn()
    const e = { label: 'x', undo: fn, dismiss }
    pushUndo({ label: 'y', undo: () => {} })
    pushUndo(e)
    await runUndo(e)
    expect(fn).toHaveBeenCalledOnce()
    expect(undoDepth()).toBe(1)
    await undoLast()
    expect(fn).toHaveBeenCalledOnce()
  })
  it('⌘Z dismisses the toast of what it undid', async () => {
    const dismiss = vi.fn()
    pushUndo({ label: 'x', undo: () => {}, dismiss })
    await undoLast()
    expect(dismiss).toHaveBeenCalled()
  })
  it('keeps at most 50', () => {
    for (let i = 0; i < 60; i++) pushUndo({ label: String(i), undo: () => {} })
    expect(undoDepth()).toBe(50)
  })
})
