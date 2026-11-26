/**
 * Benchmark (search.md「性能目标」: keyword queries within 200 ms on 100 000 assets). Builds a 100k-document
 * index with mixed Chinese / English names, tags, descriptions, prompts and document text, then times
 * representative queries and prints median and p95. The assertion uses the median, so one slow run on a busy
 * machine does not fail it; set BB_BENCH_DOCS to change the size.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IdSet, SearchDoc } from '@bowerbird/plugin-sdk'
import { KeywordIndex } from './store.js'

const N = Number(process.env.BB_BENCH_DOCS ?? 100_000)
const TARGET_MS = 200

const ZH = ['宝箱', '提灯', '药水', '卷轴', '金币', '木质', '黄铜', '卡通', '低多边形', '写实', '城镇', '森林', '洞穴', '商店', '界面', '图标', '角色', '怪物', '武器', '盔甲', '火焰', '冰霜', '暖光', '夜晚', '雾气', '石头', '草地', '旗帜', '马车', '水井']
const EN = ['chest', 'lantern', 'potion', 'scroll', 'coin', 'wooden', 'brass', 'cartoon', 'lowpoly', 'realistic', 'town', 'forest', 'cave', 'shop', 'icon', 'hero', 'monster', 'sword', 'armor', 'fire', 'frost', 'glow', 'night', 'fog', 'stone', 'grass', 'banner', 'wagon', 'well', 'texture']
const FOLDERS = ['props/chest', 'props/potion', 'characters/hero', 'characters/npc', 'environments/forest', 'ui/shop', 'ui/icons', 'audio/sfx', 'vfx', 'references/photography']

let seed = 42
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!
const words = (a: string[], n: number) => Array.from({ length: n }, () => pick(a))

function makeDoc(i: number): SearchDoc {
  const stem = `${pick(EN)}_${pick(EN)}_${i}`
  const ext = pick(['png', 'glb', 'wav', 'md', 'mp4'])
  const folder = pick(FOLDERS)
  return {
    id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    name: `${stem}.${ext}`, stem, path: `${folder}/${stem}.${ext}`, folder,
    tags: words(ZH, 2), autoTags: rnd() < 0.5 ? words(EN, 3) : [],
    description: rnd() < 0.6 ? `${words(ZH, 4).join('')}，${words(EN, 3).join(' ')}` : '',
    autoDescription: rnd() < 0.4 ? words(EN, 8).join(' ') : '',
    prompts: rnd() < 0.3 ? [`${words(EN, 6).join(', ')}，${words(ZH, 3).join('')}`] : [],
    text: ext === 'md' ? Array.from({ length: 6 }, () => words(ZH, 8).join('') + '。' + words(EN, 6).join(' ')).join('\n') : '',
    format: ext === 'md' ? 'doc' : 'image'
  }
}

let dir: string, idx: KeywordIndex
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kw-bench-'))
  idx = new KeywordIndex(path.join(dir, 'k.sqlite'))
  const t0 = performance.now()
  for (let s = 0; s < N; s += 5000) idx.index(Array.from({ length: Math.min(5000, N - s) }, (_, k) => makeDoc(s + k)))
  console.log(`[bench] indexed ${N} docs in ${Math.round(performance.now() - t0)} ms`)
}, 600_000)
afterAll(() => { idx.close(); fs.rmSync(dir, { recursive: true, force: true }) })

function time(q: string, candidates?: IdSet, runs = 9): { median: number; p95: number; hits: number } {
  const ms: number[] = []
  let hits = 0
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now()
    hits = idx.query(q, { limit: 50, candidates }).length
    ms.push(performance.now() - t0)
  }
  ms.sort((a, b) => a - b)
  return { median: ms[Math.floor(runs / 2)]!, p95: ms[Math.min(runs - 1, Math.ceil(runs * 0.95) - 1)]!, hits }
}

describe(`keyword query on ${N} documents`, () => {
  const half: string[] = []
  for (let i = 0; i < N; i += 2) half.push(`00000000-0000-7000-8000-${String(i).padStart(12, '0')}`)
  const halfSet = new Set(half)
  const candidates: IdSet = { has: x => halfSet.has(x), size: halfSet.size, [Symbol.iterator]: () => halfSet[Symbol.iterator]() }
  const small = new Set(half.slice(0, 2000))
  const smallSet: IdSet = { has: x => small.has(x), size: small.size, [Symbol.iterator]: () => small[Symbol.iterator]() }

  it.each([
    ['低多边形 (trigram, Chinese)', '低多边形', undefined],
    ['lantern (trigram, English)', 'lantern', undefined],
    ['brass lantern (two terms)', 'brass lantern', undefined],
    ['texture (very common)', 'texture', undefined],
    ['宝箱 (two characters → substring)', '宝箱', undefined],
    ['箱 (one character → substring)', '箱', undefined],
    ['lantern in 50 000 candidates', 'lantern', candidates],
    ['宝箱 in 2 000 candidates', '宝箱', smallSet],
    ['no match', 'zzzqqq', undefined]
  ] as const)('%s', (label, q, cand) => {
    const r = time(q, cand)
    console.log(`[bench] ${label.padEnd(36)} median ${r.median.toFixed(1).padStart(6)} ms  p95 ${r.p95.toFixed(1).padStart(6)} ms  hits ${r.hits}`)
    expect(r.median).toBeLessThan(TARGET_MS)
  })
})
