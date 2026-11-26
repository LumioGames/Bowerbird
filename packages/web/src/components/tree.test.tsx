import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Row, RowRoleContext, useTreeKeys } from './blocks'

afterEach(cleanup)

/** The side bar's folder tree in miniature (P1-8): roving tabindex, arrows, expand / collapse, Enter, Shift+F10. */
function Tree({ onOpen, onMenu }: { onOpen: (p: string) => void; onMenu: (p: string) => void }) {
  const [open, setOpen] = React.useState<Set<string>>(new Set())
  const keys = useTreeKeys<HTMLDivElement>()
  const row = (path: string, depth: number, kids: boolean) => (
    <Row key={path} label={path} depth={depth} toggle={kids} expanded={open.has(path)} selected={path === 'b'}
      onToggle={() => setOpen(o => { const n = new Set(o); if (n.has(path)) n.delete(path); else n.add(path); return n })}
      onClick={() => onOpen(path)} onContextMenu={e => { e.preventDefault(); onMenu(path) }} />
  )
  return (
    <RowRoleContext.Provider value="treeitem">
      <div role="tree" aria-label="文件夹" {...keys}>
        {row('a', 0, true)}
        {open.has('a') && row('a/x', 1, false)}
        {row('b', 0, false)}
      </div>
    </RowRoleContext.Provider>
  )
}

describe('side-bar tree keyboard (WAI-ARIA tree)', () => {
  it('one row in the Tab order; arrows move; → opens and steps in; ← steps out and closes; ↵ opens; Shift+F10 menu', () => {
    const onOpen = vi.fn(), onMenu = vi.fn()
    render(<Tree onOpen={onOpen} onMenu={onMenu} />)
    const item = (name: string) => screen.getByRole('treeitem', { name })
    // roving: the selected row is the Tab stop
    expect(item('b').tabIndex).toBe(0)
    expect(item('a').tabIndex).toBe(-1)
    item('b').focus()
    fireEvent.keyDown(item('b'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(item('a'))
    expect(item('a').tabIndex).toBe(0)
    expect(item('a').getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' })
    expect(item('a').getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(item('a/x'))
    expect(item('a/x').getAttribute('aria-level')).toBe('2')
    fireEvent.keyDown(item('a/x'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(item('a'))
    fireEvent.keyDown(item('a'), { key: 'ArrowLeft' })
    expect(item('a').getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(item('a'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('a')
    fireEvent.keyDown(item('a'), { key: 'F10', shiftKey: true })
    expect(onMenu).toHaveBeenCalledWith('a')
    fireEvent.keyDown(item('a'), { key: 'End' })
    expect(document.activeElement).toBe(item('b'))
  })

  it('outside a tree a Row is a plain row: no treeitem role, not focusable', () => {
    render(<div><Row label="x" selected /></div>)
    expect(screen.queryByRole('treeitem')).toBeNull()
    expect(screen.getByText('x').closest('[tabindex]')).toBeNull()
  })
})
