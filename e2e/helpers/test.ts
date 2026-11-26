import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'
export type { Locator, Page, Route } from '@playwright/test'

/**
 * The `test` every spec uses. Pages open with the onboarding hints turned off (onboarding.md「测试」), so the tour and
 * the first-visit bubbles do not sit over what the other tests look at; the onboarding tests turn them back on with
 * `test.use({ hints: true })`. Only an empty record is filled in: a test that writes its own keeps it.
 */
export const test = base.extend<{ hints: boolean }>({
  hints: [false, { option: true }],
  context: async ({ context, hints }, use) => {
    if (!hints) {
      await context.addInitScript(() => {
        try { if (!localStorage.getItem('bowerbird.onboarding')) localStorage.setItem('bowerbird.onboarding', JSON.stringify({ off: true })) } catch { /* no storage */ }
      })
    }
    await use(context)
  }
})
