import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Slider } from '@bowerbird/plugin-sdk/web'

beforeAll(() => { (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } })
afterEach(cleanup)

describe('corner marks have names, not only a title', () => {
  it('stage, review and issue marks read as images with their meaning', async () => {
    const { IssueMark, ReviewMark, StageMark } = await import('./marks')
    render(<div><StageMark stage="runtime" corner /><ReviewMark review="pending" corner /><IssueMark level="warning" flags={['stale']} count={2} /><ReviewMark review="approved" label /></div>)
    expect(screen.getByRole('img', { name: '运行时物料' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '待审' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '上游已更新 2' })).toBeTruthy()
    // with its label shown, the words are the name (no extra image)
    expect(screen.queryByRole('img', { name: '通过' })).toBeNull()
    expect(screen.getByText('通过')).toBeTruthy()
  })
})

describe('accessible names', () => {
  it('a slider\'s name goes to its focusable thumb (axe aria-input-field-name)', () => {
    render(<Slider aria-label="缩略图大小" min={96} max={320} value={[160]} />)
    expect(screen.getByRole('slider', { name: '缩略图大小' })).toBeTruthy()
  })
})
