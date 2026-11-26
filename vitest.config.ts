import path from 'node:path'
import { defineConfig } from 'vitest/config'

const r = (p: string) => path.resolve(import.meta.dirname, p)

// Tests import workspace packages from source, so no build is needed before `pnpm test`.
const alias = [
  { find: /^@bowerbird\/schema$/, replacement: r('packages/schema/src/index.ts') },
  { find: /^@bowerbird\/schema\/locale$/, replacement: r('packages/schema/src/locale.ts') },
  { find: /^@bowerbird\/plugin-sdk\/web$/, replacement: r('packages/plugin-sdk/src/web/index.ts') },
  { find: /^@bowerbird\/plugin-sdk\/testing$/, replacement: r('packages/plugin-sdk/src/testing/index.ts') },
  { find: /^@bowerbird\/plugin-sdk$/, replacement: r('packages/plugin-sdk/src/index.ts') },
  { find: /^@bowerbird\/core$/, replacement: r('packages/core/src/index.ts') },
  { find: /^@bowerbird\/server$/, replacement: r('packages/server/src/index.ts') },
  { find: /^@bowerbird\/mcp$/, replacement: r('packages/mcp/src/index.ts') }
]

/**
 * Performance assertions (engineering.md「性能基准」): measured on an otherwise idle process, so `pnpm test` runs them in
 * a second step with `--no-file-parallelism` after the other tests, instead of side by side with ~125 other files.
 */
const BENCH = ['packages/*/src/**/bench.test.ts', 'plugins/*/src/**/bench.test.ts', 'packages/core/src/scanner/__tests__/scale.test.ts']

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/{schema,core,server,cli,mcp,plugin-sdk}/src/**/*.test.ts', 'plugins/*/src/**/*.test.ts', 'fixtures/**/*.test.ts', 'tests/**/*.test.ts'],
          // the timing benchmarks run in their own project, after everything else, one file at a time (BENCH below)
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/plugin-sdk/src/web/**', ...BENCH],
          testTimeout: 30_000,
          hookTimeout: 60_000
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'bench',
          environment: 'node',
          include: BENCH,
          exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
          testTimeout: 120_000,
          hookTimeout: 300_000
        }
      },
      {
        resolve: { alias: [...alias, { find: /^@\//, replacement: r('packages/web/src') + '/' }] },
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: [r('vitest.web-setup.ts')],
          include: ['packages/web/src/**/*.test.{ts,tsx}', 'packages/plugin-sdk/src/web/**/*.test.{ts,tsx}', 'plugins/*/src/web/**/*.test.{ts,tsx}'],
          testTimeout: 30_000
        }
      }
    ]
  }
})
