/**
 * bowerbird.search-keyword — server part (search.md「关键词检索」, ADR-028): a full-text index over names, tags,
 * descriptions, AI tags and descriptions, folder names, prompts and document text, kept in an SQLite FTS5
 * trigram table inside this plugin's own data folder. Queries return hits within the kernel's candidate set,
 * with the snippet and highlight ranges where the hit was found outside the name.
 * Uses only @bowerbird/plugin-sdk and @bowerbird/schema (engineering.md hard rule 2).
 */
import fs from 'node:fs'
import path from 'node:path'
import { defineServerPlugin, type SearchProvider } from '@bowerbird/plugin-sdk'
import { KeywordIndex } from './store.js'

export const PROVIDER_ID = 'keyword'
export const INDEX_FILE = 'keyword.sqlite'

export function keywordProvider(index: KeywordIndex): SearchProvider {
  return {
    id: PROVIDER_ID,
    async index(docs) { index.index(docs) },
    async remove(ids) { index.remove(ids) },
    async query(q, opts) { return index.query(q, opts) },
    async clear() { index.clear() }
  }
}

/**
 * One index per activation (each library activates the plugin with its own data folder). `deactivate()` has
 * no way to say which library it is for, so it closes every handle; the indexes of libraries still active
 * reopen their database on their next call (KeywordIndex.db).
 */
const open = new Set<KeywordIndex>()

export default defineServerPlugin({
  activate(ctx) {
    fs.mkdirSync(ctx.dataDir, { recursive: true })
    const index = new KeywordIndex(path.join(ctx.dataDir, INDEX_FILE))
    open.add(index)
    ctx.register.searchProvider(keywordProvider(index))
  },
  deactivate() {
    for (const i of open) i.close()
    open.clear()
  }
})
