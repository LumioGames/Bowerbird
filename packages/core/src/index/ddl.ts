/**
 * Index database schema (pipeline-and-cache.md「索引」). FROZEN CONTRACT between the core lines:
 * - library/scanner/service/integrity (line core-A) write assets, tags, relations, tech, analysis, probe, checks,
 *   issues, records, trash, files;
 * - query/pipeline/plugins (line core-B) read those tables and own jobs and cache_files.
 * Everything here is rebuildable from the library folder. Bump INDEX_SCHEMA_VERSION to force a rebuild.
 * Columns may be added (never renamed or removed) by the owning line; readers must not depend on additions.
 */
export const INDEX_SCHEMA_VERSION = 1

/** Bit flags in `assets.flags` (search.md「结果」flags). */
export const FLAG = { stale: 1, broken: 2, missing: 4, processing: 8, failed: 16 } as const
/** `assets.issue_level`: highest issue level on the asset. */
export const ISSUE_RANK = { none: 0, info: 1, warning: 2, error: 3 } as const

export const DDL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per asset known to the library (including missing ones; trashed ones live in "trash").
CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY,           -- GUID
  path            TEXT NOT NULL UNIQUE,       -- library-relative, POSIX
  folder          TEXT NOT NULL,              -- dirname of path ('' = root)
  name            TEXT NOT NULL,              -- basename
  stem            TEXT NOT NULL,              -- name without extension
  ext             TEXT NOT NULL,              -- lower-case with dot, '' for bundles
  format          TEXT NOT NULL DEFAULT 'unknown',
  plugin          TEXT,                       -- claiming plugin id
  hash            TEXT NOT NULL,
  size            INTEGER NOT NULL DEFAULT 0,
  mtime_ms        INTEGER NOT NULL DEFAULT 0, -- asset file mtime at last hash (scan shortcut)
  meta_mtime_ms   INTEGER NOT NULL DEFAULT 0, -- sidecar mtime at last read
  stage           TEXT NOT NULL,
  review          TEXT NOT NULL,              -- EFFECTIVE review status
  review_status   TEXT,                       -- stored status
  bundle          INTEGER NOT NULL DEFAULT 0,
  auxiliary       INTEGER NOT NULL DEFAULT 0,
  missing         INTEGER NOT NULL DEFAULT 0, -- file gone, sidecar kept (R7)
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,              -- latest of created / modified / last version
  description     TEXT,
  auto_description TEXT,
  origin          TEXT,                       -- production record that produced it
  method          TEXT,                       -- method of that record (filter by method)
  thumb_state     TEXT NOT NULL DEFAULT 'pending', -- ready | pending | render | none | failed
  thumb_key       TEXT,                       -- cache key of the current 'thumb'
  thumb_manual    INTEGER NOT NULL DEFAULT 0,
  aspect          REAL,
  badge           TEXT,
  cell_title      TEXT,
  cell_excerpt    TEXT,
  flags           INTEGER NOT NULL DEFAULT 0, -- FLAG bits
  issue_level     INTEGER NOT NULL DEFAULT 0, -- ISSUE_RANK of the worst issue
  issue_count     INTEGER NOT NULL DEFAULT 0,
  member_count    INTEGER NOT NULL DEFAULT 0, -- assets that 'belongs' to it
  missing_plugin  TEXT,                       -- JSON {id, range, displayName} when a required plugin is absent
  meta_json       TEXT NOT NULL,              -- full copy of the .bmeta (R8, R10)
  seq             INTEGER NOT NULL DEFAULT 0  -- bumps on every write (change detection)
);
CREATE INDEX IF NOT EXISTS assets_folder   ON assets(folder);
CREATE INDEX IF NOT EXISTS assets_hash     ON assets(hash);
CREATE INDEX IF NOT EXISTS assets_modified ON assets(modified_at);
CREATE INDEX IF NOT EXISTS assets_created  ON assets(created_at);
CREATE INDEX IF NOT EXISTS assets_name     ON assets(name);
CREATE INDEX IF NOT EXISTS assets_format   ON assets(format);
CREATE INDEX IF NOT EXISTS assets_stage    ON assets(stage);
CREATE INDEX IF NOT EXISTS assets_review   ON assets(review);
CREATE INDEX IF NOT EXISTS assets_size     ON assets(size);
CREATE INDEX IF NOT EXISTS assets_by       ON assets(created_by);

CREATE TABLE IF NOT EXISTS tags (
  asset_id TEXT NOT NULL,
  tag      TEXT NOT NULL,
  ai       INTEGER NOT NULL DEFAULT 0,        -- 1 = unadopted AI tag (auto.tags)
  PRIMARY KEY (asset_id, tag, ai)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag, ai);

CREATE TABLE IF NOT EXISTS relations (
  from_id  TEXT NOT NULL,
  type     TEXT NOT NULL,
  to_id    TEXT NOT NULL,
  slot     TEXT NOT NULL DEFAULT '',
  to_hash  TEXT,
  record   TEXT,
  note     TEXT,
  broken   INTEGER NOT NULL DEFAULT 0,
  stale    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_id, type, to_id, slot)
);
CREATE INDEX IF NOT EXISTS relations_to ON relations(to_id, type);

CREATE TABLE IF NOT EXISTS tech (
  asset_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  num      REAL,
  txt      TEXT,
  PRIMARY KEY (asset_id, key)
);
CREATE INDEX IF NOT EXISTS tech_key_num ON tech(key, num);

CREATE TABLE IF NOT EXISTS analysis (
  asset_id TEXT NOT NULL,
  plugin   TEXT NOT NULL,
  json     TEXT NOT NULL,
  PRIMARY KEY (asset_id, plugin)
);

-- Probe output that is not tech: slot names found in the file, unresolved ones, searchable text.
CREATE TABLE IF NOT EXISTS probe (
  asset_id        TEXT PRIMARY KEY,
  plugin          TEXT,
  refs_json       TEXT,
  unresolved_json TEXT,
  text            TEXT
);

CREATE TABLE IF NOT EXISTS checks (
  asset_id    TEXT NOT NULL,
  validator   TEXT NOT NULL,
  rule        TEXT NOT NULL,
  verdict     TEXT NOT NULL,
  message     TEXT NOT NULL,
  values_json TEXT,
  PRIMARY KEY (asset_id, validator, rule)
);

CREATE TABLE IF NOT EXISTS issues (
  id           TEXT PRIMARY KEY,               -- stable id from the cause
  type         TEXT NOT NULL,
  level        TEXT NOT NULL,
  asset_id     TEXT,
  rel_type     TEXT,
  rel_to       TEXT,
  rel_slot     TEXT,
  path         TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  found_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_asset ON issues(asset_id);
CREATE INDEX IF NOT EXISTS issues_type  ON issues(type);

CREATE TABLE IF NOT EXISTS records (
  id     TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  by     TEXT NOT NULL,
  at     TEXT NOT NULL,
  prompt TEXT,
  json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trash (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  original_path TEXT NOT NULL,
  deleted_at    TEXT NOT NULL,
  deleted_by    TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  format        TEXT NOT NULL DEFAULT 'unknown',
  info_json     TEXT NOT NULL,
  meta_json     TEXT
);
CREATE INDEX IF NOT EXISTS trash_asset ON trash(asset_id);

-- Scan shortcut for every file seen (claimed or not): skip hashing when size and mtime are unchanged.
CREATE TABLE IF NOT EXISTS files (
  path     TEXT PRIMARY KEY,
  size     INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  hash     TEXT
);

-- Task queue (processing + creation + render jobs). Owned by the pipeline.
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- process | create | render
  asset_id    TEXT,
  stage       TEXT,
  creator     TEXT,
  plugin      TEXT,
  status      TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,     -- higher first: visible > recent > backlog
  attempts    INTEGER NOT NULL DEFAULT 0,
  progress    REAL,
  message     TEXT,
  action_json TEXT,
  error       TEXT,
  retryable   INTEGER NOT NULL DEFAULT 1,
  outputs_json TEXT NOT NULL DEFAULT '[]',
  params_json TEXT,
  by          TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  run_after   INTEGER NOT NULL DEFAULT 0      -- epoch ms; retry backoff
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS jobs_asset  ON jobs(asset_id, stage);

-- Cache files written for current assets (cleanup removes files no row points to).
CREATE TABLE IF NOT EXISTS cache_files (
  key        TEXT NOT NULL,
  asset_id   TEXT NOT NULL,
  stage      TEXT NOT NULL,
  variant    TEXT NOT NULL,
  rel_path   TEXT NOT NULL,                   -- relative to the cache dir
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, stage, variant)
);
CREATE INDEX IF NOT EXISTS cache_key ON cache_files(key);
`
