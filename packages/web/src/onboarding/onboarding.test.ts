import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { LOCALE_IDS } from '@bowerbird/schema/locale'
import { DICTS } from '../lib/i18n'
import { allSeen } from './OnboardingHost'
import { choose, nextStep, PAGE_HINTS, place, placeOf, TOUR, type Facts } from './model'
import {
  finishTour, formatKey, getOnboarding, hasSeen, markFormatSeen, markSeen, ONBOARDING_KEY, pageKey, parseOnboarding,
  replayOnboarding, resetOnboardingCache, setHintsOff
} from './store'
import { messages as imageText } from '../../../../plugins/image/src/web/i18n'
import { messages as videoText } from '../../../../plugins/video/src/web/i18n'
import { messages as audioText } from '../../../../plugins/audio/src/web/i18n'
import { messages as modelText } from '../../../../plugins/model/src/web/i18n'
import { messages as docText } from '../../../../plugins/doc/src/web/i18n'
import { translate } from '@bowerbird/plugin-sdk/web'

const here = path.dirname(fileURLToPath(import.meta.url))
const COPY = fs.readFileSync(path.resolve(here, '../../../../design/docs/copy.md'), 'utf8')
/** copy.md「新手引导」only, up to the next section. */
const ONBOARDING_COPY = (() => { const from = COPY.indexOf('## 新手引导'); const to = COPY.indexOf('\n## ', from + 1); return COPY.slice(from, to < 0 ? undefined : to) })()

describe('onboarding record (onboarding.md「记在哪里」)', () => {
  beforeEach(() => { localStorage.removeItem(ONBOARDING_KEY); resetOnboardingCache() })

  it('starts empty and survives broken or odd values', () => {
    expect(parseOnboarding(null)).toEqual({ off: false, tourDone: false, seen: [], rev: 0 })
    expect(parseOnboarding('{not json')).toEqual({ off: false, tourDone: false, seen: [], rev: 0 })
    expect(parseOnboarding('[1,2]')).toMatchObject({ off: false, seen: [] })
    expect(parseOnboarding(JSON.stringify({ off: 'yes', tourDone: 1, seen: ['page:a', 3, 'page:a'], rev: 'x' })))
      .toEqual({ off: false, tourDone: false, seen: ['page:a'], rev: 0 })
    expect(parseOnboarding(JSON.stringify({ off: true, tourDone: true, seen: ['format:model'], rev: 2 })))
      .toEqual({ off: true, tourDone: true, seen: ['format:model'], rev: 2 })
  })

  it('remembers what was seen in this browser', () => {
    markSeen(pageKey('queue'))
    markSeen(pageKey('queue'))
    markFormatSeen('model')
    markFormatSeen('unknown')
    markFormatSeen(null)
    finishTour()
    expect(getOnboarding()).toMatchObject({ tourDone: true, seen: ['page:queue', 'format:model'] })
    resetOnboardingCache()
    const s = getOnboarding()
    expect(hasSeen(pageKey('queue'), s)).toBe(true)
    expect(hasSeen(formatKey('model'), s)).toBe(true)
    expect(hasSeen(formatKey('unknown'), s)).toBe(false)
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!)).toMatchObject({ tourDone: true })
  })

  it('「关掉提示」keeps what was seen;「重新看导览」forgets it, turns hints on and starts again', () => {
    markSeen(pageKey('trash'))
    finishTour()
    setHintsOff(true)
    expect(getOnboarding()).toMatchObject({ off: true, tourDone: true, seen: ['page:trash'] })
    setHintsOff(false)
    expect(getOnboarding()).toMatchObject({ off: false, seen: ['page:trash'] })
    setHintsOff(true)
    replayOnboarding()
    expect(getOnboarding()).toEqual({ off: false, tourDone: false, seen: [], rev: 1 })
  })
})

describe('which hint shows (onboarding.md「先后」)', () => {
  const page = PAGE_HINTS.find(h => h.id === 'queue')!
  const base: Facts = { state: { off: false, tourDone: true }, onBrowse: false, tourReady: false, overlay: false, page: null, format: null, cooldown: false }

  it('nothing while hints are off or a dialog is open', () => {
    expect(choose({ ...base, page, state: { off: true, tourDone: true } })).toBeNull()
    expect(choose({ ...base, page, overlay: true })).toBeNull()
  })

  it('on the browse page the tour comes first, and only once the grid has assets', () => {
    const fmt = { format: 'model', assetId: 'a' }
    expect(choose({ ...base, onBrowse: true, state: { off: false, tourDone: false }, tourReady: true, format: fmt })).toEqual({ kind: 'tour' })
    // an empty library: no tour, and nothing else either until the tour has been seen
    expect(choose({ ...base, onBrowse: true, state: { off: false, tourDone: false }, tourReady: false, format: fmt })).toBeNull()
  })

  it('elsewhere the page hint shows even before the tour is over', () => {
    expect(choose({ ...base, state: { off: false, tourDone: false }, page })).toEqual({ kind: 'page', hint: page })
  })

  it('new-file hints: browse page only, after the page hint, and not again until the place changes', () => {
    const fmt = { format: 'video', assetId: 'v' }
    expect(choose({ ...base, onBrowse: true, format: fmt })).toEqual({ kind: 'format', format: 'video', assetId: 'v' })
    expect(choose({ ...base, onBrowse: true, format: fmt, cooldown: true })).toBeNull()
    expect(choose({ ...base, onBrowse: false, format: fmt })).toBeNull()
    expect(choose({ ...base, onBrowse: true, format: fmt, page })).toEqual({ kind: 'page', hint: page })
  })

  it('a place is the path and query, not the one-shot selection nor the order of parameters', () => {
    expect(placeOf('/libraries/x/', '?select=abc&folder=props')).toBe('/libraries/x?folder=props')
    expect(placeOf('/libraries/x', '?q=a&folder=props')).toBe(placeOf('/libraries/x', '?folder=props&q=a'))
    expect(placeOf('/libraries/x', '?folder=props')).not.toBe(placeOf('/libraries/x', '?folder=chars'))
    expect(placeOf('/libraries/x', '')).toBe('/libraries/x')
  })

  it('a tour step whose anchor is missing is skipped', () => {
    expect(nextStep(0, () => true)).toBe(0)
    expect(nextStep(1, st => st.id !== 'cells' && st.id !== 'find')).toBe(3)
    expect(nextStep(4, () => false)).toBeNull()
    expect(TOUR.map(s => s.id)).toEqual(['views', 'cells', 'find', 'inspector', 'footer'])
  })
})

describe('stops looking once nothing is left', () => {
  const pages = PAGE_HINTS.map(h => pageKey(h.id))
  it('needs the tour over, every page hint and every format with a sentence seen', () => {
    expect(allSeen({ tourDone: true, seen: [...pages, 'format:model'] }, ['model'])).toBe(true)
    expect(allSeen({ tourDone: false, seen: [...pages, 'format:model'] }, ['model'])).toBe(false)
    expect(allSeen({ tourDone: true, seen: pages.slice(1) }, [])).toBe(false)
    expect(allSeen({ tourDone: true, seen: pages }, ['model', 'audio'])).toBe(false)
  })
})

describe('bubble placement', () => {
  const view = { width: 1440, height: 900 }
  const bubble = { width: 280, height: 110 }

  it('goes on the preferred side when it fits, with the hand between bubble and anchor', () => {
    const a = { left: 600, top: 200, width: 80, height: 28 }
    const p = place(a, bubble, view, 'bottom')
    expect(p.side).toBe('bottom')
    expect(p.hy).toBeGreaterThanOrEqual(a.top + a.height)
    expect(p.y).toBeGreaterThan(p.hy)
    expect(p.x).toBe(600 + 40 - 140)
  })

  it('flips to the other side when there is no room, and stays inside the window', () => {
    const low = place({ left: 600, top: 840, width: 80, height: 28 }, bubble, view, 'bottom')
    expect(low.side).toBe('top')
    expect(low.y + bubble.height).toBeLessThanOrEqual(840)
    const edge = place({ left: 8, top: 300, width: 200, height: 28 }, bubble, view, 'left')
    expect(edge.side).toBe('right')
    const corner = place({ left: 1400, top: 10, width: 30, height: 20 }, bubble, view, 'bottom')
    expect(corner.x + bubble.width).toBeLessThanOrEqual(view.width - 8)
  })

  it('in a window too small for any side, takes the roomiest and clamps to the window', () => {
    const p = place({ left: 100, top: 100, width: 200, height: 200 }, bubble, { width: 400, height: 400 }, 'right')
    expect(p.x).toBeGreaterThanOrEqual(8)
    expect(p.y).toBeGreaterThanOrEqual(8)
  })
})

describe('onboarding text', () => {
  const keys = [...TOUR.flatMap(s => [s.title, s.text]), ...PAGE_HINTS.flatMap(h => [h.title, h.text]),
    'ob.help', 'ob.replay', 'ob.hintsOff', 'ob.hintsOn', 'ob.skip', 'ob.next', 'ob.done', 'ob.gotIt', 'ob.open', 'ob.tour.count']

  it('every hint has its words in every language', () => {
    for (const l of LOCALE_IDS) for (const k of keys) expect(DICTS[l][k], `${l} ${k}`).toBeTruthy()
  })

  it('the Chinese is what copy.md says (新手引导)', () => {
    expect(ONBOARDING_COPY.length).toBeGreaterThan(200)
    expect(ONBOARDING_COPY).not.toContain('## 创建插件')
    for (const k of keys.filter(k => k !== 'ob.tour.count')) expect(ONBOARDING_COPY, k).toContain(DICTS['zh-CN'][k]!)
  })

  it('every built-in format has its sentence in every language, as copy.md writes it in Chinese', () => {
    for (const m of [imageText, videoText, audioText, modelText, docText]) {
      const zh = translate(m, 'zh-CN', 'intro')
      expect(ONBOARDING_COPY).toContain(zh)
      for (const l of LOCALE_IDS) {
        const s = translate(m, l, 'intro')
        expect(s.trim().length, l).toBeGreaterThan(5)
        if (l !== 'zh-CN') expect(s, l).not.toBe(zh)
      }
    }
  })
})
