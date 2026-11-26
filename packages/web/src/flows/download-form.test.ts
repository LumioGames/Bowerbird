import { afterEach, describe, expect, it, vi } from 'vitest'
import { postDownload } from './download-form'

describe('postDownload (export zip through a plain form POST)', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

  it('posts the fields as an urlencoded form into a hidden frame, so the browser streams the file to disk', () => {
    let submitted: HTMLFormElement | null = null
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) { submitted = this })
    postDownload('/api/v1/libraries/lib-1/export', { ids: ['a', 'b'], withDeps: true, layout: 'flat', name: 'chest.zip' }, () => {})
    expect(submitted).not.toBeNull()
    const form = submitted!
    expect(form.method).toBe('post')
    expect(form.getAttribute('action')).toBe('/api/v1/libraries/lib-1/export')
    expect(form.enctype).toBe('application/x-www-form-urlencoded')
    const frame = document.querySelector('iframe')!
    expect(form.target).toBe(frame.name)
    expect(frame.hidden).toBe(true)
    expect([...new FormData(form).entries()]).toEqual([['ids', 'a'], ['ids', 'b'], ['withDeps', 'true'], ['layout', 'flat'], ['name', 'chest.zip']])
    // the form is gone after submitting; the frame stays for the download
    expect(document.querySelector('form')).toBeNull()
  })

  it('an error answer loaded into the frame becomes the error message; an empty load is ignored', () => {
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const errors: string[] = []
    postDownload('/x', { ids: ['a'], withDeps: false, layout: 'keep', name: 'a.zip' }, m => errors.push(m))
    const frame = document.querySelector('iframe')!
    frame.dispatchEvent(new Event('load')) // about:blank, or a download that left the frame empty
    expect(errors).toEqual([])
    expect(document.querySelector('iframe')).not.toBeNull()
    frame.contentDocument!.body.textContent = JSON.stringify({ error: { code: 'not_found', message: '资产不存在' } })
    frame.dispatchEvent(new Event('load'))
    expect(errors).toEqual(['资产不存在'])
    expect(document.querySelector('iframe')).toBeNull()
  })
})
