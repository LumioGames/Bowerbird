import { describe, expect, it } from 'vitest'
import zhShell from '../i18n/zh/shell'
import zhPages from '../i18n/zh/pages'
import enShell from '../i18n/en/shell'
import enPages from '../i18n/en/pages'

/**
 * lib/i18n.tsx merges `{ ...shell, ...pages }`: a key in both dictionaries is silently taken from pages.ts — with a
 * different wording or other {placeholders} the shell's callers would show the wrong sentence. The two never overlap.
 */
describe('page and shell dictionaries', () => {
  it.each([['zh', zhShell, zhPages], ['en', enShell, enPages]] as const)('%s: no key is defined in both', (_lang, shell, pages) => {
    const both = Object.keys(pages).filter(k => Object.prototype.hasOwnProperty.call(shell, k))
    expect(both).toEqual([])
  })
})
