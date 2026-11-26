import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DialogHost } from '../../overlays/dialogs'
import { choose, promptText } from './dialogs'

afterEach(() => cleanup())

async function outside() {
  // Radix attaches its outside-pointer listener on the next tick
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  fireEvent.pointerDown(document.body)
}

describe('web-2 dialog frames (E-07)', () => {
  it('a confirm-type dialog (哪一个是原件？ / 保留哪一份记录？) is an alertdialog and clicking outside cancels it', async () => {
    render(<DialogHost />)
    let p!: Promise<string | undefined>
    act(() => { p = choose({ title: '哪一个是原件？', choices: [{ label: '对调', value: 'swap' }, { label: '没错，确认', value: 'confirm', variant: 'primary' }] }) })
    await screen.findByRole('alertdialog')
    await outside()
    await expect(p).resolves.toBeUndefined()
  })

  it('a form dialog does not close on an outside click', async () => {
    render(<DialogHost />)
    act(() => { void promptText({ title: '新建分组', confirmLabel: '新建', label: '分组名称' }) })
    await screen.findByRole('dialog')
    await outside()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
