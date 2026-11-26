import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale } from './i18n'
import { fmtDate, fmtDateTime, fmtDayTime } from './format'

/** Dates are written the way each language writes them (ADR-061); local time. */
const iso = new Date(2026, 10, 24, 16, 42).toISOString()
const was = getLocale()
afterEach(() => setLocale(was))

describe('dates per language', () => {
  it.each([
    ['zh-CN', '11 月 24 日 16:42', '11 月 24 日', '24 日 16:42'],
    ['en', 'Nov 24 16:42', 'Nov 24', '24, 16:42'],
    ['ja', '11月24日 16:42', '11月24日', '24日 16:42'],
    ['ko', '11월 24일 16:42', '11월 24일', '24일 16:42']
  ] as const)('%s', (locale, dateTime, date, dayTime) => {
    setLocale(locale)
    expect(fmtDateTime(iso)).toBe(dateTime)
    expect(fmtDate(iso)).toBe(date)
    expect(fmtDayTime(iso)).toBe(dayTime)
  })
})
