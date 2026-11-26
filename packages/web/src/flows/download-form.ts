/**
 * A download the browser saves by itself: the fields go out as a plain urlencoded form POST into a hidden frame,
 * so a large zip streams straight to disk instead of being read into memory first (`POST /export` accepts this
 * form, download only). An attachment leaves the frame empty; an error answer (JSON) loads into it and is
 * reported through `onError`.
 */
export interface DownloadFields { ids: string[]; withDeps: boolean; layout: 'keep' | 'flat'; name: string }

let seq = 0

export function postDownload(action: string, fields: DownloadFields, onError: (message: string) => void, doc: Document = document): void {
  const frame = doc.createElement('iframe')
  frame.name = `bb-download-${Date.now()}-${++seq}`
  frame.hidden = true
  frame.tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')
  doc.body.appendChild(frame)
  let timer: ReturnType<typeof setTimeout> | null = null
  const cleanup = () => { if (timer) clearTimeout(timer); frame.remove() }
  frame.addEventListener('load', () => {
    let text = ''
    try { text = frame.contentDocument?.body?.textContent?.trim() ?? '' } catch { /* not readable: nothing to report */ }
    if (!text) return // about:blank, or the download went to the browser
    let message = text
    try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text } catch { /* plain text */ }
    onError(message)
    cleanup()
  })
  const form = doc.createElement('form')
  form.method = 'post'
  form.action = action
  form.enctype = 'application/x-www-form-urlencoded'
  form.target = frame.name
  form.hidden = true
  const add = (name: string, value: string) => {
    const input = doc.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  const { ids, ...rest } = fields
  for (const id of ids) add('ids', id)
  for (const [key, value] of Object.entries(rest)) add(key, String(value))
  doc.body.appendChild(form)
  form.submit()
  form.remove()
  // the frame only matters while the answer is coming in
  timer = setTimeout(cleanup, 10 * 60_000)
}
