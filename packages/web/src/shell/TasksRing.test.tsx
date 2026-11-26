import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TasksRing, tasksLabel, tasksState } from './TasksRing'

describe('side bar tasks ring (product decision 2026-11-26)', () => {
  it('derives idle / busy / failed from the jobs overview', () => {
    expect(tasksState(undefined)).toEqual({ kind: 'idle' })
    expect(tasksState({ busy: 0, waitingRender: 0, failed: [] })).toEqual({ kind: 'idle' })
    expect(tasksState({ busy: 2, waitingRender: 3, failed: [] })).toEqual({ kind: 'busy', count: 5 })
    // running work wins over old failures; failures show once nothing is running
    expect(tasksState({ busy: 1, waitingRender: 0, failed: [{} as never] })).toEqual({ kind: 'busy', count: 1 })
    expect(tasksState({ busy: 0, waitingRender: 0, failed: [{} as never, {} as never] })).toEqual({ kind: 'failed', count: 2 })
  })
  it('names the state for tooltips and screen readers', () => {
    expect(tasksLabel({ kind: 'idle' })).toBe('任务')
    expect(tasksLabel({ kind: 'busy', count: 5 })).toBe('任务 · 5 个正在处理')
    expect(tasksLabel({ kind: 'failed', count: 2 })).toBe('任务 · 2 个失败')
  })
  it('turns an arc only while busy and colours the ring when something failed', () => {
    const busy = render(<TasksRing state={{ kind: 'busy', count: 1 }} />).container
    expect(busy.querySelectorAll('circle')).toHaveLength(2)
    expect(busy.querySelector('svg')!.getAttribute('data-state')).toBe('busy')
    const idle = render(<TasksRing state={{ kind: 'idle' }} />).container
    expect(idle.querySelectorAll('circle')).toHaveLength(1)
    const failed = render(<TasksRing state={{ kind: 'failed', count: 1 }} />).container
    expect(failed.querySelector('circle')!.getAttribute('stroke')).toBe('var(--warning-ink)')
    // a faint tint, not a bright full circle (the ring is deliberately quiet)
    expect(Number(failed.querySelector('circle')!.getAttribute('stroke-opacity'))).toBeLessThan(0.6)
  })
})
