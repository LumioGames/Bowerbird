# fixtures

Sample data for tests and demos. The sample libraries are **not kept in the repository** (a download stays clean): `pnpm test`, `pnpm e2e` and `pnpm serve:xingluo` generate them first through `scripts/ensure-fixtures.mjs` when they are missing or their generators changed; `pnpm fixtures` regenerates them (needs ffmpeg). Every file is produced by a script in `scripts/` (images drawn with sharp from
the prototype's SVG drawings, models built with three.js and written as GLB / ASCII FBX, audio synthesised, video
encoded with ffmpeg, documents written as text), and the output is deterministic. Do not edit generated files: change the generator and run `pnpm fixtures`.

| Path | What |
|------|------|
| `xingluo/` | 「星落镇」sample library, a copy of the prototype's data (`design/prototype/data.js`, trash seeds from `pages.js`, documents from `viewers.js`) |
| `upload-batch/` | the batch a reviewer drops in (`data.js` `batch`): two `icon_lantern.png` (`export/ui`, `export/hud`), `export/v2/lantern_basecolor.png` next to the root one, `lantern_concept.png` that the library already has |
| `scripts/` | generators and helpers (below) |
| `plugins/forge/` | test-only creator plugin「Forge」`community.forge@0.4.0` (fake AI, no network); not published |
| `perf-100k/` | output of `pnpm perf` (git-ignored) |

## Scripts

Run from the repo root after `pnpm build` (the scripts import the built `@bowerbird/schema`).

| Command | What |
|---------|------|
| `pnpm fixtures` | regenerate `xingluo/` and `upload-batch/` (needs a local `ffmpeg` with libvpx-vp9, libopus and prores_ks; users of the repo do not need it, the output is committed), then run the verifier |
| `node fixtures/scripts/verify-xingluo.mjs [dir] [--json]` | schema-check every `.bmeta` / record / view / trash entry, compare hashes with the files, list the integrity problems; the expected ones are in `EXPECTED` |
| `node fixtures/scripts/copy-library.mjs <dir> [--rebase-trash]` | working copy for a server (never serve the committed folder in place). `--rebase-trash` keeps trash entries as old as they were on 2026-11-25 so the 7-day retention does not purge them |
| `node fixtures/scripts/make-first-open.mjs <dir>` | the asset files only — no `.bmeta`, no `.bowerbird/` — for the「首次打开」test |
| `pnpm perf [<dir>] [--count N]` | `generate-100k.mjs --with-sidecars`: N (default 100 000) small, all-different files in 3 folder levels with tags, stages, reviews and relations, plus `.bowerbird/library.json`. Without `--with-sidecars` (call the script directly) it is a first-open folder |
| `BB_FIXTURES_REGEN=1 npx vitest run fixtures/scripts` | also regenerate into a temp dir and compare byte for byte |

Output is deterministic: fixed seeds, fixed timestamps (the prototype's clock, 2026-11-25 04:00 UTC), ffmpeg with
`-fflags +bitexact` and single-threaded VP9. Byte equality holds for the same sharp / librsvg / ffmpeg versions.

## 「星落镇」at a glance

72 assets with `.bmeta` (71 files: `characters/hero/hero_idle.fbx` is missing on purpose), 10 production records,
4 trash entries, 3 smart folders, 6.0 MB. The problems it contains on purpose:

| Problem | Where |
|---------|-------|
| `missing-file` | `characters/hero/hero_idle.fbx` (only the `.bmeta`) |
| `broken-reference` | `props/potion/potion.glb` → `potion_basecolor.png`, which is in the trash (restore fixes it) |
| `stale-upstream` | `props/chest/chest_icon.png`: its source `chest.glb` changed on 11-24 |
| `duplicate-guid` | `ui/shop/btn_buy (1).png` — copied together with its `.bmeta` |
| `metadata-conflict` | `ui/shop/shop_prototype.html (lin's conflicted copy 2026-11-24).bmeta` (Dropbox naming), tags differ |
| `duplicate-content` | `ui/hud/panel_bg.png` = `ui/shop/panel_bg.png`; also `btn_buy (1).png` = `btn_buy.png` |
| `plugin-missing` | `characters/hero/hero_run.skel` — `library.json` declares `community.spine ^1.4.0` and `pluginFormats[".skel"]` |
| `pipeline-failed` (in a browser) | `environments/intro_cutscene.mov` is ProRes 4444; `environments/world_map_16k.png` is 16384×9216 |
| unknown formats | `chest_high.blend`, `rock_01.obj`, `sky_noon.hdr`, `forest_dusk.hdr`, `ui/shop_v2/shop.css`, `shop.js` |

Waiting for a browser render: every model (no `.bowerbird/cache/` is shipped; `npc_guard.glb` and `npc_merchant.glb` are
the ones just added). `ui/shop_v2/` holds the loose files of a web prototype for「把这个文件夹作为一个资产…」.
