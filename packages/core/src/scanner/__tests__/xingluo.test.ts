/**
 * The「星落镇」sample library (fixtures/xingluo): opening a copy and scanning it must raise exactly the problems the
 * fixture contains on purpose. Set BB_XINGLUO to point at another copy; skipped when the fixture is not there.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTmp, ctx, makeLib, type TestLib } from '../../service/__tests__/harness.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = process.env.BB_XINGLUO ?? path.resolve(here, '../../../../../fixtures/xingluo')
const FIXTURE_NOW = Date.UTC(2026, 10, 25, 4)
const BUILTINS = ['bowerbird.image', 'bowerbird.video', 'bowerbird.audio', 'bowerbird.model', 'bowerbird.doc', 'bowerbird.search-keyword']

let libs: TestLib[] = []
afterEach(async () => { for (const t of libs) await t.close(); libs = []; cleanupTmp() })

describe.skipIf(!fs.existsSync(path.join(FIXTURE, '.bowerbird/library.json')))('星落镇 sample library', () => {
  it('raises exactly the expected problems', async () => {
    const t = await makeLib({ copyFrom: FIXTURE, fixtureNow: FIXTURE_NOW, plugins: { extraEnabled: BUILTINS.map(id => ({ id, version: '0.1.0' })) } })
    libs.push(t)
    expect((await t.svc.info(ctx)).state).toBe('ready')
    const rows = t.issues().map(i => {
      const path = i.asset_id ? t.row(i.asset_id)?.path ?? i.asset_id : (JSON.parse(i.details_json).plugin as string)
      return `${i.type} ${path}`
    }).sort()
    expect(rows).toEqual([
      'broken-reference props/potion/potion.glb',
      'duplicate-content ui/hud/panel_bg.png',
      'duplicate-guid ui/shop/btn_buy (1).png',
      'metadata-conflict ui/shop/shop_prototype.html',
      'missing-file characters/hero/hero_idle.fbx',
      'plugin-missing characters/hero/hero_run.skel',
      'stale-upstream props/chest/chest_icon.png'
    ].sort())
    // ADR-045: the name without the copy suffix is the original, and references stay with it
    const original = t.sidecar('ui/shop/btn_buy.png')
    const copy = t.sidecar('ui/shop/btn_buy (1).png')
    expect(copy.id).not.toBe(original.id)
    expect(copy.relations?.some(r => r.type === 'source' && r.to === original.id)).toBe(true)
    // the conflict copy is not an asset; both tag lists are there for the dialog
    const conflict = t.issues('metadata-conflict')[0]!
    expect(JSON.parse(conflict.details_json)).toMatchObject({ kind: 'copy', conflictPath: "ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta", source: 'dropbox' })
    expect(t.rowByPath("ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24)")).toBeUndefined()
    const broken = JSON.parse(t.issues('broken-reference')[0]!.details_json)
    expect(broken).toMatchObject({ inTrash: true, toName: 'potion_basecolor.png' })
    // a second scan changes nothing
    const before = t.issues().map(i => i.id).sort()
    await t.scan()
    expect(t.issues().map(i => i.id).sort()).toEqual(before)
  })
})
