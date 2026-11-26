import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/** Run axe on the page (WCAG 2.1 A/AA); returns violations of impact serious or critical. */
export async function axeViolations(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (include) b = b.include(include)
  const r = await b.analyze()
  return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
}
