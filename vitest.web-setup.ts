/**
 * Web tests run in Chinese, the source language the tests are written against (like e2e/playwright.config.ts
 * `locale: 'zh-CN'`). jsdom reports en-US as the browser language, which the shell would otherwise follow (ADR-061).
 */
try { localStorage.setItem('bowerbird.locale', 'zh-CN') } catch { /* no storage */ }
document.documentElement.lang = 'zh-CN'
