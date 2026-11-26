/**
 * The text every built-in plugin and the Forge test plugin hand to the shell is translated (ADR-061): each manifest
 * string (names, description, format names, settings form) and each string `activate()` registers (creator and
 * action names, their forms and input roles), plus Forge's UI slot titles and job messages, has an entry in every
 * language of LOCALES except the one the plugin writes in. A language added to LOCALES is checked automatically.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALE_IDS } from '@bowerbird/schema/locale'
import { loadPluginForTest, manifestStrings, manifestTextProblems, registeredStrings } from '@bowerbird/plugin-sdk/testing'
import type { WebPlugin } from '@bowerbird/plugin-sdk/web'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BUILTIN = ['image', 'video', 'audio', 'model', 'doc', 'search-keyword'].map(p => path.join(ROOT, 'plugins', p))
const FORGE = path.join(ROOT, 'fixtures/plugins/forge')

/** The UI slot titles of a web module (the shell shows them through the manifest translations). */
function uiTitles(web: WebPlugin): string[] {
  return Object.values(web.ui ?? {}).flatMap(list => (list as Array<{ title?: string }>).map(x => x.title ?? '')).filter(Boolean)
}

/** Messages Forge's jobs report (progress, follow-up, results, failures), as the shell receives them. */
const FORGE_JOB_TEXT = [
  '排队中', '生成中 7%', '生成中 96%', 'AI 生图完成，挑出要留下的', '生成模型完成，挑出要留下的', '挑选…', '已登记 2 个', '已取消',
  '缺少外部工具 forge-cli', '服务没有响应（503）', '提示词不能为空', '先选一个四视图', '已生成 chest_variant.png', '只能对一张图片生成变体', '找不到 chest.png 的文件'
]

describe('plugin text in every language', () => {
  it('checks the four languages at least', () => {
    expect(LOCALE_IDS).toEqual(expect.arrayContaining(['zh-CN', 'en', 'ja', 'ko']))
  })

  for (const dir of BUILTIN) {
    it(`${path.basename(dir)}: every manifest and registered string is translated`, async () => {
      const p = await loadPluginForTest(dir)
      const strings = [...manifestStrings(p.manifest), ...registeredStrings(p.ctx.registered)]
      expect(strings.length).toBeGreaterThan(0)
      expect(manifestTextProblems(p.manifest, strings)).toEqual([])
    })
  }

  it('Forge: manifest, creators, action, UI slot titles and job messages are translated', async () => {
    const p = await loadPluginForTest(FORGE)
    const web = (await import('../../fixtures/plugins/forge/src/web/index.js')).default as WebPlugin
    const reg = registeredStrings(p.ctx.registered)
    for (const s of ['AI 生图', '生成模型', '提示词', '随机', '参考图', '四视图', '设计对象', '生成变体（Forge）', '色相']) expect(reg).toContain(s)
    expect(manifestStrings(p.manifest)).toEqual(expect.arrayContaining(['Forge', '服务地址', '不模拟', '服务没有响应（503）']))
    const strings = [...manifestStrings(p.manifest), ...reg, ...uiTitles(web), ...FORGE_JOB_TEXT]
    expect(manifestTextProblems(p.manifest, strings)).toEqual([])
  })
})
