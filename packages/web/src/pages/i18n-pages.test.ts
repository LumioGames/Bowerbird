import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import zh from '../i18n/zh/pages'
import en from '../i18n/en/pages'
import { ISSUE_TYPES, PIPELINE_STAGES } from '@bowerbird/schema'

/** Every page string web-2 asks for exists in both dictionaries, and the two have the same keys. */
const root = resolve(__dirname, '..')
const dirs = ['detail', 'graph', 'versions', 'review', 'compare', 'pages'].map(d => join(root, d))
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'test' ? [] : files(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

/* keys built at run time: prefix + every value it can take */
const families: Record<string, readonly string[]> = {
  'cmp.mode.': ['side', 'wipe', 'overlay', 'diff'],
  'graph.legend.': ['source', 'uses', 'belongs', 'stale', 'broken'],
  'iss.act.': ['relink', 'remove-relation', 'restore-target', 'relocate', 'confirm-deleted', 'swap-dialog', 'confirm', 'keep-dialog', 'compare', 'replace', 'acknowledge', 'trash', 'log', 'retry', 'install', 'clear-thumbnail', 'reshot', 'ignore', 'mark-copy'],
  'iss.level.': ['error', 'warning', 'info'],
  'iss.type.': ISSUE_TYPES,
  'w2.method.': ['ai-generate', 'manual', 'slice', 'render', 'export', 'convert', 'copy', 'other'],
  'ov.group.': ['art', 'model', 'texture', 'icon', 'sfx', 'anim', 'other'],
  'rel.made.': ['source', 'uses', 'belongs'],
  'rel.sent.': ['source', 'uses', 'belongs'],
  'rel.sentRich.': ['source', 'uses', 'belongs', 'other'],
  'rel.sentShort.': ['source', 'uses', 'belongs'],
  'w2.rel.type.': ['source', 'uses', 'belongs', 'other'],
  'rel.typeHint.': ['source', 'uses', 'belongs'],
  'rq.done.': ['approved', 'rejected', 'skipped'],
  'rq.why.': ['missing', 'processing', 'unviewable', 'plugin', 'error'],
  'set.': ['library', 'machine', 'agent', 'plugins', 'tasks'],
  'set.p.state.': ['enabled', 'disabled', 'failed', 'missing'],
  'stage.': PIPELINE_STAGES
}
const indirect = ['ver.lore.sub', 'ver.lfs.sub', 'detail.tab.view', 'detail.tab.doc', 'rev.approvedToast', 'rev.rejectedToast', 'iss.done.keepLocal', 'iss.done.keepConflict',
  'graph.inTrash', 'graph.gone', 'rel.inTrash', 'rel.gone', 'cmp.newMinusOld', 'cmp.bVsA', 'set.scope.library', 'set.scope.machine', 'rel.belongsIn']

describe('page strings', () => {
  it('zh and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('every key used by web-2 is defined', () => {
    const used = new Set<string>(indirect)
    for (const f of dirs.flatMap(files)) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]!)
      for (const m of src.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) {
        const fam = families[m[1]!]
        expect(fam, `dynamic key family ${m[1]} in ${f}`).toBeTruthy()
        for (const v of fam!) used.add(m[1]! + v)
      }
    }
    for (const [prefix, values] of Object.entries(families)) for (const v of values) used.add(prefix + v)
    const missing = [...used].filter(k => !(k in zh) || !(k in en))
    expect(missing).toEqual([])
  })

  it('copy.md sentences are kept word for word', () => {
    expect(zh['rev.notePh']).toBe('哪里需要改（必填）')
    expect(zh['set.lan.title']).toBe('允许局域网里的其他电脑访问？')
    expect(zh['trash.emptyTitle']).toBe('回收站是空的')
    expect(zh['iss.emptyText']).toBe('扫描会随时发现新问题，并显示在这里和左栏的「有问题」里。')
    expect(zh['rq.held']).toBe('另有 {n} 个暂时审不了')
  })
})
