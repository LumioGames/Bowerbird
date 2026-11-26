import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Vocabulary } from '@bowerbird/schema'
import { SearchBox } from './SearchBox'
import { FilterPanel } from './FilterPanel'
import { EMPTY_STATE, type BrowseState } from './query'

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(cleanup)

const vocabulary = {
  stages: [], reviews: [], relationTypes: [], templates: [], methods: [], actors: [], designObjects: [],
  formats: [{ id: 'model', displayName: '模型', plugin: 'bowerbird.model', count: 3 }, { id: 'image', displayName: '图片', plugin: 'bowerbird.image', count: 9 }],
  tags: [{ name: '宝箱', count: 3 }]
} as Vocabulary

/** The browse page in miniature: one state, edited by both the search box and the filter panel. */
function Harness({ initial = EMPTY_STATE }: { initial?: BrowseState }) {
  const [state, setState] = React.useState<BrowseState>(initial)
  return (
    <>
      <SearchBox state={state} onCommit={patch => setState(s => ({ ...s, ...patch }))} source={{ vocabulary }} />
      <FilterPanel state={state} onChange={patch => setState(s => ({ ...s, ...patch }))} vocabulary={vocabulary} total={3} onClear={() => setState(EMPTY_STATE)} onSaveSmart={() => {}} />
      <output data-testid="filter">{JSON.stringify(state.filter)}</output>
      <output data-testid="text">{state.text}</output>
    </>
  )
}

const input = () => screen.getByRole('combobox', { name: '搜索' }) as HTMLInputElement
const chipTexts = () => [...document.querySelectorAll('span.font-mono')].map(s => s.textContent)

describe('search box ↔ filter panel', () => {
  it('a typed condition becomes a chip and presses the panel chip', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'stage:runtime ', selectionEnd: 14 } })
    expect(chipTexts()).toContain('stage:runtime')
    expect(JSON.parse(screen.getByTestId('filter').textContent!).stage).toEqual(['runtime'])
    const panelChip = screen.getAllByRole('button', { pressed: true })
    expect(panelChip.some(b => b.textContent?.includes('运行时'))).toBe(true)
  })

  it('a chip pressed in the panel appears in the search box; pressing it again removes it', () => {
    render(<Harness />)
    const btn = screen.getAllByRole('button').find(b => b.textContent?.startsWith('模型'))!
    fireEvent.click(btn)
    expect(chipTexts()).toContain('format:model')
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent?.startsWith('模型'))!)
    expect(chipTexts()).not.toContain('format:model')
  })

  it('the chip × and Backspace in an empty box both clear the condition in the panel', () => {
    render(<Harness initial={{ ...EMPTY_STATE, filter: { review: ['pending'], hasIssues: true } }} />)
    fireEvent.click(screen.getAllByRole('button', { name: '移除条件' })[1]!)
    expect(JSON.parse(screen.getByTestId('filter').textContent!).hasIssues).toBeUndefined()
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(JSON.parse(screen.getByTestId('filter').textContent!).review).toBeUndefined()
  })

  it('free words stay as the query after Enter', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: '宝箱 tag:宝箱', selectionEnd: 9 } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('text').textContent).toBe('宝箱')
    expect(chipTexts()).toContain('tag:宝箱')
  })
})

/** Like the browse page: each commit is merged onto the state of the render it was made in. */
function SnapshotHarness() {
  const [state, setState] = React.useState<BrowseState>(EMPTY_STATE)
  return (
    <>
      <SearchBox state={state} onCommit={patch => setState({ ...state, ...patch })} source={{ vocabulary }} />
      <output data-testid="filter">{JSON.stringify(state.filter)}</output>
      <output data-testid="text">{state.text}</output>
    </>
  )
}

describe('syntax completion', () => {
  it('a fast pick (within the typing delay) is not overwritten by the half-typed word', async () => {
    vi.useFakeTimers()
    try {
      render(<SnapshotHarness />)
      fireEvent.change(input(), { target: { value: 'sta', selectionEnd: 3 } })
      fireEvent.keyDown(input(), { key: 'Tab' })
      await act(async () => { await vi.advanceTimersByTimeAsync(20) })
      expect(input().value).toBe('stage:')
      fireEvent.keyDown(input(), { key: 'ArrowDown' })
      fireEvent.keyDown(input(), { key: 'ArrowDown' })
      await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(JSON.parse(screen.getByTestId('filter').textContent!).stage).toEqual(['runtime'])
      expect(screen.getByTestId('text').textContent).toBe('')
      expect(chipTexts()).toContain('stage:runtime')
    } finally { vi.useRealTimers() }
  })


  it('the box is a combobox that owns the list and points at the highlighted option', () => {
    render(<Harness />)
    expect(input().getAttribute('aria-expanded')).toBe('false')
    fireEvent.change(input(), { target: { value: 'f', selectionEnd: 1 } })
    expect(input().getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: '搜索' })
    expect(input().getAttribute('aria-controls')).toBe(list.id)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id)
  })

  it('offers keys with their meaning, ↓ moves, Tab inserts the key', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'f', selectionEnd: 1 } })
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(expect.arrayContaining(['format:格式', 'folder:文件夹']))
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('format:')
  })

  it('values come from the library; choosing one makes a chip', async () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'format:mo', selectionEnd: 9 } })
    expect(screen.getByRole('option').textContent).toBe('model模型')
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
    expect(chipTexts()).toContain('format:model')
    expect(input().value).toBe('')
  })
})
