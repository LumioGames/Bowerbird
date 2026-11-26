import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DialogHost } from '../overlays/dialogs'
import { askRejectNote } from './actions'
import { checkMessage } from './ReviewTab'

afterEach(() => cleanup())

describe('打回… dialog on the review tab', () => {
  it('↵ in the comment box sends it; an empty one is stopped; Shift+↵ is a new line', async () => {
    render(<DialogHost />)
    let p!: Promise<string | undefined>
    act(() => { p = askRejectNote('chest.glb') })
    const box = await screen.findByRole('textbox', { name: '打回意见' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(box, { target: { value: '左肩甲穿模' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('textbox', { name: '打回意见' })).toBeTruthy()
    fireEvent.keyDown(box, { key: 'Enter' })
    await expect(p).resolves.toBe('左肩甲穿模')
  })
})

describe('automatic check line', () => {
  it('drops the label the plugin puts in front of its message (the label is shown already)', () => {
    const c = { validator: 'size-vs-design', rule: 'size-vs-design', verdict: 'pass' as const, message: '尺寸与设计对象：模型 1.26 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m' }
    expect(checkMessage(c)).toBe('模型 1.26 × 0.95 × 0.87 m · 目标 1.26 × 0.95 × 0.87 m')
    expect(checkMessage({ ...c, message: '模型 1 · 目标 1' })).toBe('模型 1 · 目标 1')
  })
})
