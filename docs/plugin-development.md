# 插件开发

Bowerbird 的内核不认识任何文件格式、AI 服务或版本控制系统，这些能力都由插件提供。随内核发布的六个内置插件（图片、视频、音频、3D 模型、文档、关键词搜索）和第三方插件用的是**同一套接口**，没有私有通道；它们的源码就是最好的参考（仓库里的 `plugins/`）。

本文说明一个插件长什么样、服务端与网页两部分怎么写、怎么构建和测试，以及插件在本机以什么权限运行。接口以 `@bowerbird/plugin-sdk` 导出的类型为准，设计说明见 `.spec/knowledge/features/plugin-system.md`。

**图标**：界面贡献里的 `icon` 传组件，或者写外壳图标表里有的 Lucide 名字（`packages/web/src/components/icon-table.ts`）；表里没有的名字显示兜底图标。

**许可**：写插件用到的三个包，插件开发包 `@bowerbird/plugin-sdk`、构建工具 `@bowerbird/plugin-build` 与共用数据结构 `@bowerbird/schema`，按 MIT 许可。插件自己的代码用什么许可、收不收费，都由你定。

## 包结构

一个插件就是一个 npm 包：

```text
my-plugin/
├── package.json          清单写在 "bowerbird" 字段里
├── src/
│   ├── server.ts         服务端入口（可选）：默认导出 ServerPlugin
│   ├── shared/           服务端和网页都用的纯函数（可选）
│   └── web/index.tsx     网页入口（可选）：默认导出 WebPlugin
├── tsconfig.json         引用下面两个
├── tsconfig.server.json  NodeNext，输出 dist/
└── tsconfig.web.json     Bundler + DOM，只出类型；打包由 bowerbird-plugin-build 做
```

插件只依赖 `@bowerbird/plugin-sdk` 与 `@bowerbird/schema`，再加自己需要的第三方 npm 包。不要引用内核或网页外壳的任何包。

**依赖分两类**，装 Bowerbird 的人只下载第一类：

- `dependencies`：**服务端代码运行时真正 import 的包**，例如 `@bowerbird/plugin-sdk`、`sharp`、`better-sqlite3`。网页部分用到的库（例如 `three`、`markdown-it`）会被打进 `dist/web.js`，不要放这里。
- `devDependencies`：构建工具 `@bowerbird/plugin-build`（提供 `bowerbird-plugin-build` 命令，带着 esbuild、Tailwind 以及网页部分类型检查要用的 React 与界面库类型）、只在网页部分用的库、各种 `@types/*`。

```bash
npm install @bowerbird/plugin-sdk
npm install -D @bowerbird/plugin-build typescript
```

## 清单

```jsonc
{
  "name": "@studio/bowerbird-spine",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "build": "tsc -b && bowerbird-plugin-build" },
  "bowerbird": {
    "id": "studio.spine",                 // 全局唯一，小写
    "displayName": "Spine 动画",
    "apiVersion": 1,                      // 插件接口的主版本
    "server": "./dist/server.js",
    "web": "./dist/web.js",
    "contributes": {
      "formats": [
        { "id": "spine", "displayName": "Spine", "extensions": [".skel", ".json"], "priority": 50, "thumbnail": "browser" }
      ],
      "settings": {
        "type": "object",
        "properties": {
          "defaultSkin": { "type": "string", "title": "默认皮肤", "scope": "library" },
          "apiKey":      { "type": "string", "title": "访问凭据", "scope": "machine" }
        }
      }
    },
    "requires": { "tools": [] }
  },
  "dependencies": { "@bowerbird/plugin-sdk": "^0.1.0" },
  "devDependencies": { "@bowerbird/plugin-build": "^0.1.0", "@bowerbird/schema": "^0.1.0", "typescript": "^5.9.0" }
}
```

- `contributes` 里出现哪个键，就表示提供哪类扩展点：`formats`、`searchProviders`、`enrichers`、`sources`、`creators`、`validators`、`templates`、`actions`、`ui`、`versionStore`、`relationTypes`、`auth`。内核只读清单决定加载什么，不扫描代码；`activate()` 里登记的实现必须和清单一一对应（契约测试会检查）。
- `formats[].thumbnail`：`server` 表示服务端生成缩略图（实现 `thumbnail()`）；`browser` 表示由有人打开页面时的浏览器渲染（实现网页端的 `renderThumbnail`，服务端**不要**实现 `thumbnail()`）；`none` 表示不生成图片缩略图（例如文档，网格单元自己画）。
- 多个插件都认领同一个后缀时，按 `priority` 从高到低调用各自的 `match()`，第一个认领的胜出。
- `requires.tools` 写依赖的外部命令行工具，缺失时设置页里会提示。内置插件都不依赖外部工具。
- 可选的 `l10n`（与 `sourceLocale`）给出清单文字和登记的名字在其他界面语言里的译文，见「网页 · 多种语言」。

### 设置的 scope

每个设置项用 `scope` 标明存放位置：`library` 随资产库走，写进资产库设置、跟着库同步；`machine` 只在这台电脑上（缺省值）。**访问凭据一类的设置只能是 `machine`。** 插件用 `ctx.settings.get(key)` 读到的是两处合并后的有效值。

## 服务端

```ts
import { defineServerPlugin, type FormatHandler } from '@bowerbird/plugin-sdk'

const spine: FormatHandler = {
  id: 'spine',
  async match(file) {
    // 读文件头确认是否认领；file.head 是前 64 KiB。返回 null 表示不认领。
    return looksLikeSpine(file.head) ? { format: 'spine', confidence: 1 } : null
  },
  async probe(asset) {
    const data = await asset.read()
    return {
      tech: { bones: 42, animations: 3 },       // 只能是 number / string / boolean
      badge: '3 段动画',                          // 网格角标
      references: ['hero.atlas'],                // 文件里写着的位置名（见下）
      text: 'idle walk run'                      // 供关键词搜索的正文
    }
  },
  async summarize(asset) {
    return { text: 'Spine 骨骼动画，42 根骨骼，3 段动画：idle、walk、run。' }
  }
}

export default defineServerPlugin({
  activate(ctx) {
    ctx.register.format(spine)
  },
  deactivate() { /* 关闭打开的文件、数据库连接 */ }
})
```

**上下文 `ctx`** 是插件访问内核的唯一途径：

| 成员 | 作用 |
|------|------|
| `library` | 只读查询资产、关系、生产记录、问题；`filePath(id)` 给出文件的绝对路径 |
| `cache` | 写本插件产生的缓存文件（按内容寻址，写入后不再修改） |
| `settings` | 读本插件的设置 |
| `log` | 日志 |
| `dataDir` | 本机、可重建的插件数据目录（`~/.bowerbird/libraries/<库>/plugins/<插件>/`），不进资产库、不同步；关键词搜索的全文索引就放在这里（ADR-028） |
| `tmpDir` | 本机临时目录，例如创建插件没挑中的候选产出 |
| `exec(tool, args)` | 调用外部命令行工具；工具不存在时以 `ENOENT` 拒绝 |
| `register.*` | 登记各扩展点的实现，以及 `route`（挂在 `/plugins/<插件标识>/` 下的自有接口；`web`、`settings` 等路径由内核保留） |

插件**不能直接写资产库**：修改资产信息通过各扩展点的返回值交给内核；新增资产把登记结构（`RegisterRequest`，与 `POST /assets` 同样的字段）交给内核，例如 `JobContext.register()`、`ActionResult.assets`、入库来源的 `ingest()`。

### 格式插件各阶段

| 方法 | 管线阶段 | 返回 | 说明 |
|------|----------|------|------|
| `match(file)` | 识别 | `{ format, confidence? }` 或 `null` | 读文件头；包式资产（一个文件夹）`file.bundle` 为真、`head` 为空 |
| `probe(asset)` | 提取 | `ProbeResult` | `tech` 技术信息（进索引，可筛选，如 `width:>=1024`）；`badge` 角标；`analysis` 结构化分析（只进索引，例如图片主色）；`references` 位置名；`text` 正文；`auxiliary` 是否附属文件；`aspect` 缩略图宽高比 |
| `derive(asset)` | 派生 | 转换文件 | 只在浏览器无法直接用原文件时需要 |
| `thumbnail(asset)` | 缩略图 | `ThumbnailSet` | 仅 `thumbnail: server`；图片一律 WebP，`thumb` 长边 512、`preview` 长边 2048、`poster` 长边 1024；`peaks` 为 JSON；必须给出 `aspect` |
| `summarize(asset)` | 摘要 | `{ text }` | 给 Agent 看的文字部分 |

**位置名（`references`）**：文件里写着的外部文件名（贴图名、`.bin` 名、Markdown 里的相对图片路径）只当「这里有一个位置」，不表示引用的是谁。内核第一次读到时按文件名自动配上带 `slot` 的引用关系，之后以元数据文件为准（ADR-018）。查看器用 `source.slotUrl(位置名)` 取对方资产的内容，关系更换后看到的就是新的对方。

### 处理不可信的文件

资产库里的文件可能是截断的、损坏的，也可能是故意构造的。插件的每一个阶段都要在有限的时间与内存里结束：要么给出结果，要么干净地抛错（内核把它记为处理失败）。

- **不按文件声明的长度整块分配**：盒子、元素、块的长度字段先与上限比较（视频插件：`moov` 64 MiB、EBML 元数据 16 MiB），超出就拒绝。
- **检查不合常理的参数**：例如音频的采样率只接受 1 kHz–768 kHz、声道 1–32，否则不认领。
- **防解压炸弹**：解码量与输入字节数之比异常时停止（音频：先读小块，超过两分钟后每字节最多 1000 帧；总长最多 6 小时）；图片沿用 sharp 的默认像素上限。
- **只读需要的部分**：文档插件提取与摘要最多读 8 MiB，`tech.truncated` 标明截断；JSON 只解析一次，不为摘要重新排版整棵树。
- **正则表达式保持线性**：不写相邻或嵌套的无界量词（如 `(.+?)\s*#*\s*$`），能手写扫描的就手写；用 `runWithin()` 给这类函数写带超时的测试。
- **包式资产里的符号链接**：用 `lstat` 检查，指向包外的链接一律拒绝。

**同一个资产的几个阶段往往连着调用**：解码代价大的格式可以按 `asset.absPath + asset.hash` 缓存最近几次的结果（音频插件就是这样，解码一次供提取、缩略图、摘要三个阶段用）。

### 搜索插件

```ts
ctx.register.searchProvider({
  id: 'keyword',
  async index(docs) { /* 新增或更新：同一个 id 再送一次就是替换 */ },
  async remove(ids) {},
  async query(q, { candidates, limit }) { return [/* { id, score, snippet? } 按分数从高到低 */] },
  async clear() { /* 索引重建前内核会调用 */ }
})
```

- `candidates` 是已经通过结构化筛选的资产集合（没有时表示全库），**只能**在它里面返回。
- 多个搜索插件的结果由内核按排名做倒数排名融合，分数的量纲不重要，顺序重要。
- 命中在名称以外时给出 `snippet`：`field`（`prompt` / `description` / `text` / `tags` / `path`）、片段文字和高亮区间 `ranges`（相对片段文字的 `[起, 止)`）。

## 网页

```tsx
import { defineWebPlugin, useShell, type ViewerProps } from '@bowerbird/plugin-sdk/web'

function SpineViewer({ asset, source, mode }: ViewerProps) {
  const shell = useShell()
  // source.url / source.fetch() 读当前内容或某个历史版本，查看器不必区分
  // source.slotUrl('hero.atlas') 按位置名取依赖文件；source.bundleUrl('a.png') 取包式资产里的文件
  return <div className="flex size-full items-center justify-center bg-surface-well text-ink-2">…</div>
}

export default defineWebPlugin({
  formats: {
    spine: {
      Viewer: SpineViewer,
      // Compare、compareModes、GridCell、renderThumbnail、renderSummary、techLabels 都可选
    }
  }
})
```

`FormatView` 的成员：

| 成员 | 作用 |
|------|------|
| `Viewer` | 详情页与快速预览里的查看器；`mode` 为 `detail` / `quicklook` / `review` / `compare`，快速预览与对比时不显示工具条 |
| `Compare` | 对比视图，收到 `left`、`right`、`mode`（`side` / `wipe` / `overlay` / `diff`）和卷帘位置 `split`。**卷帘分界线由外壳画**，插件只按 `split` 裁切 |
| `compareModes(left, right)` | 这一对资产能用哪些方式；用不了的附 `reason`，外壳在点击时用提示条说明。不处理这一对时返回 `null`（另一侧可以是别的格式，例如模型对四视图） |
| `GridCell` | 自定义网格单元（`hover.active` 与横向位置 `hover.x` 由外壳给出）；不提供时显示缩略图 |
| `renderThumbnail` | 浏览器渲染工作者调用，返回 `RenderedSet`（WebP Blob 与 `aspect`） |
| `renderSummary` | 浏览器渲染 Agent 摘要的概览图 |
| `techLabels` | 对比页技术信息表里显示哪些 `tech` 键、叫什么 |
| `formatBadge(badge, locale)` | 把服务端写下的角标换成外壳当前的语言（见下文「多种语言」） |
| `intro(locale)` | 网格里第一次出现这一类文件时，外壳用小手指指着它，气泡里写格式名和这一句话：打开后能做什么，例如「能看通道、分屏，还能和四视图对照。」。一句话就够；不提供或返回 `null` 时这一类不提示 |

**渲染失败**：`renderThumbnail` 抛出的错误可以带 `retryable` 属性。浏览器解不了的内容（例如这台电脑的浏览器放不了 ProRes 4444）应抛出 `retryable: false` 的错误，消息写成给人看的一句话，渲染工作者会照此提交、不再重试：

```ts
const err = Object.assign(new Error('这台电脑的浏览器放不了这种视频（ProRes 4444）'), { retryable: false })
throw err
```

**外壳的服务**：`useShell()` 给出 `api`（类型化的 HTTP 客户端）、`library`、`actor`、`toast()`、`confirm()`、`navigate()`、`pickAsset()`、`fileSource()`、`storage` 等。报错、提示、操作结果一律用 `toast`；某个功能在当前文件上读不出信息时，按钮照常显示，点击时提示「这个格式不支持」（`useUnsupportedToast()`，ADR-022）。

**多种语言**：见下一节。

**不依赖外部地址**：外壳页面有内容安全策略，只允许本服务、`data:` 与 `blob:`。插件网页部分不要从外部加载脚本、样式、字体或图片；文档插件对 Markdown 里的外链图片只显示占位与地址，不去加载。

**界面组件与样式**：外壳经 `@bowerbird/plugin-sdk/web` 提供它自己在用的 shadcn/ui 基础组件（按钮、菜单、对话框、滑块、开关……）、Magic UI 动效和 `cn()`；样式用 Tailwind，设计系统的变量已经映射成工具类，例如 `bg-surface-well`、`text-ink-2`、`text-accent-ink`、`shadow-popover`、`rounded-md`。插件界面与外壳用同一套，键盘操作和焦点管理由基础组件处理。

### 多种语言

外壳的界面语言是 `@bowerbird/schema/locale` 里的 `LOCALES`（现在是简体中文、English、日本語、한국어，以后还会加）。一句话在某个语言里没有时，依次找英文、中文（ADR-061）。插件给外壳的文字分三类，各有各的办法，都是可选的：没有译文的文字照原样显示，旧插件不用改也能用。

**1. 插件自己界面里的文字**：用 SDK 的 `defineMessages` 写字典，中文是源语言、键要齐，其余语言可以缺：

```ts
import { defineMessages, pageLocale, translate, useMessages } from '@bowerbird/plugin-sdk/web'

export const messages = defineMessages({
  'zh-CN': { play: '播放', frameOf: '帧 {i} / {n}' },
  en: { play: 'Play', frameOf: 'Frame {i} / {n}' },
  ja: { play: '再生', frameOf: 'フレーム {i} / {n}' },
  ko: { play: '재생', frameOf: '프레임 {i} / {n}' }
})

function Toolbar() { const m = useMessages(messages); return <button>{m('play')}</button> }       // 组件里：外壳当前的语言
const reason = () => translate(messages, pageLocale(), 'frameOf', { i: 1, n: 9 })                  // 组件外：外壳设在 <html lang> 上的页面语言
```

外壳直接调用、拿不到上下文的函数（`compareModes` 的 `reason`、`renderThumbnail` 的报错、`techLabels`）用 `pageLocale()`；切换语言时外壳会重新挂载页面，`techLabels` 写成 getter 就能每次取到当前语言。占位符写成 `{name}`。内置插件的写法见各自的 `src/web/i18n.ts`。

**2. 交给外壳显示的名字与表单**：清单里的 `displayName`、`description`、格式名、设置项的 `title` / `description` / `enumNames`（下拉选项的显示名，与 `enum` 一一对应）/ `x-placeholder`、关系类型名，`activate()` 里登记的创建方式名、动作名、它们的参数表单与输入角色，网页部分插槽的 `title`，以及任务进度的消息与后续按钮——这些由外壳显示，插件在清单里给出译文 `l10n`：语言 → 原文 → 译文。

```jsonc
"bowerbird": {
  "displayName": "Spine 动画",
  "contributes": {
    "settings": { "type": "object", "properties": {
      "skin": { "type": "string", "title": "默认皮肤", "enum": ["a", "b"], "enumNames": ["主皮肤", "备用"] }
    } }
  },
  "l10n": {
    "en": { "Spine 动画": "Spine animation", "默认皮肤": "Default skin", "主皮肤": "Main", "备用": "Spare", "导出中 {pct}%": "Exporting {pct}%" },
    "ja": { "Spine 动画": "Spine アニメーション", "默认皮肤": "既定のスキン", "主皮肤": "メイン", "备用": "予備", "导出中 {pct}%": "書き出し中 {pct}%" }
  }
}
```

- 原文里可以有 `{name}` 占位符，它匹配同样格式的任何文字，匹配到的部分填进译文（上例让「导出中 35%」显示成 "Exporting 35%"）；译文的占位符必须与原文相同。
- 插件的文字不是中文写的，加 `"sourceLocale": "en"`：查找时到了这个语言就直接用原文。
- 服务端把 `l10n` 与 `sourceLocale` 原样放进 `GET /plugins` 的 `PluginInfo`；外壳在设置页插件列表与插件设置表单、「新建」菜单与创建表单、右键菜单的插件动作、插件关系类型、格式名、缺少插件时的名字、任务的名字与消息、插槽标题这些地方查一遍再显示（`packages/web/src/plugins/text.ts`）。内核不读这张表。
- 按原文查，所以同一段原文在一个插件里只有一种译法；登记的名字与任务消息里不要拼进会变的中文片段（例如把两种创建方式的完成提示各写一条，而不是「{方式}完成」）。

**3. 服务端写下、外壳显示的文字**：网格角标（`ProbeResult.badge`）在读取文件时写一次，校验结果（`CheckResult.message`）在检查时写一次，都存进索引，之后按谁打开页面的语言显示。插件照旧用源语言写一份，再在网页部分提供两个可选的钩子把它说成外壳的语言——两头都在插件里，内核不认识任何格式：

```ts
export default defineWebPlugin({
  formats: {
    model: {
      Viewer,
      // 服务端写「2,480 面」；返回 null 或原样返回表示不处理
      formatBadge: (badge, locale) => { const n = /^([\d,]+) 面$/.exec(badge)?.[1]; return n ? translate(messages, locale, 'tris', { n }) : badge }
    }
  },
  // 键是清单 contributes.validators 里的校验器 id（CheckView.validator）
  validators: {
    'size-vs-design': {
      label: (check, locale) => translate(messages, locale, 'sizeCheck'),
      message: (check, locale) => sizeSentence(check.values, locale)     // 按 rule 与 values 重新组句；值不认识时返回 null
    }
  }
})
```

外壳在网格、列表、快速预览、设计对象概览与上传冲突对话框里用 `formatBadge`，在校验页签与校验队列里用 `validators`；钩子不存在、返回 null 或抛错时显示服务端写的原文。所以校验器要把组句需要的数都放进 `values`。

**检查是否译齐**：`@bowerbird/plugin-sdk/testing` 的 `messageProblems(messages)` 检查字典里每个语言都有每个键、占位符一致、没写成别的文字；`manifestTextProblems(manifest, strings)` 检查每段要交给外壳的文字在每个语言里都有译文，`strings` 用 `manifestStrings(manifest)` 加 `registeredStrings(ctx.registered)`，再补上插槽标题与任务消息。两者都按 `LOCALES` 检查，以后加了语言，测试会自动指出缺的译文：

```ts
const p = await loadPluginForTest(dir)
expect(manifestTextProblems(p.manifest, [...manifestStrings(p.manifest), ...registeredStrings(p.ctx.registered)])).toEqual([])
expect(messageProblems(messages)).toEqual([])
```

### 构建与共享运行时

```bash
pnpm build        # = tsc -b && bowerbird-plugin-build
```

`bowerbird-plugin-build`（由 `@bowerbird/plugin-build` 提供，作为插件的 devDependency 安装；它从插件自己的 `@bowerbird/plugin-sdk` 读主题 `theme.css` 与共享模块 `dist/web.js`）把 `src/web/index.tsx` 打成一个 ES 模块 `dist/web.js`：

- 网页部分 import 的第三方库都打进 `dist/web.js`，所以它们放在 `devDependencies` 就够了。
- `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`@bowerbird/plugin-sdk/web` **不打包**，运行时取外壳挂在 `globalThis.__bowerbird_shared__` 上的那一份（ADR-030）。React 的上下文与钩子只在同一个实例里有效，所以插件绝不能自带一份 React。
- 插件源码里用到的 Tailwind 工具类按共同的主题编译，模块加载时注入一段 `<style data-bb-plugin>`。外壳不扫描任何插件的源码，内置插件也走这条路。
- 网页代码里只用 `@bowerbird/schema` 的**类型**（`import type`），不要导入它的值，否则会把整个校验库打进插件。
- 可选参数：`--entry`、`--out`、`--css-source`、`--no-css`；环境变量 `BB_PLUGIN_MINIFY=0` 关闭压缩。

## 测试

`@bowerbird/plugin-sdk/testing` 提供测试工具，内置插件与 Forge 测试插件都用同一套契约跑：

```ts
import { loadPluginForTest, runRegistrationContract, runFormatContract, runSearchProviderContract, makeWav, sampleDir } from '@bowerbird/plugin-sdk/testing'

const plugin = await loadPluginForTest('/path/to/my-plugin')   // 在 Vitest 下直接导入 src/server.ts，不必先构建
runRegistrationContract(plugin)                                 // 清单与 activate() 登记的一一对应
const files = sampleDir()
await runFormatContract(plugin, [
  { file: files.write('a.wav', makeWav()), format: 'audio', techKeys: ['duration'], badge: /秒$/, thumbnails: ['thumb', 'peaks'] },
  { file: files.write('fake.wav', 'not audio'), format: null }  // 不该认领的样例
])
await runSearchProviderContract(plugin.ctx.registered.searchProviders[0]!, { shortTerms: true })
```

- `createTestContext()`：一个假的 `PluginContext`，记录登记、缓存放内存、`dataDir` 在临时目录。`exec` 默认直接抛错（内置插件没有外部依赖）；确实要调用外部工具的测试传 `{ exec: true }`，或传一个函数代替。
- `fileRefFor()` / `assetFileFor()`：把磁盘上的文件包装成 `FileRef` / `AssetFile`，可以额外传 `views`、`designObject` 等字段；`identify()` 按内核的规则（后缀初筛、优先级、`match()`）找出认领者。
- `runFormatContract()`：识别、提取（`tech` 的类型与期望值、角标、正文、分析结果可序列化）、缩略图（WebP、`peaks` 为 JSON、宽高比）、摘要；`thumbnail: browser / none` 的格式不得实现服务端缩略图。
- `runFormatContract()` 还按 WebP 文件头核对长边：`thumb` 不超过 512、`preview` 不超过 2048、`poster` 不超过 1024；样例可以用 `thumbEdge` / `previewEdge` 指定确切长边。
- `runSearchProviderContract()`：召回、排序（名称命中排在正文命中之前）、带后缀的完整文件名排第一、片段与高亮区间（高亮出来的必须正好是查询词）、中文子串、`limit`、`candidates`、更新替换、`remove`、`clear`。
- `runHostileContract(plugin, files, ms)`：每个恶意样例的识别、提取、缩略图、摘要都要在 `ms` 毫秒内返回或干净地抛错，超时即失败。`runWithin(ms, fn)` 可以打断同步代码（包括回溯中的正则），`settleWithin(ms, fn)` 限定一个 Promise 的等待时间。
- 样例生成器：`makeWav`、`makeFlac`（也能做出几十 KB 解出几小时的「解压炸弹」）、`makeMp4`、`makeWebm`、`makeGlb`、`makeGltfWithBin` 与几段示例文档，全部手写字节，不调用外部工具。

仓库里的 `tests/contract/plugins.contract.test.ts` 用一张参数表把这些契约跑遍六个内置插件与 Forge，并额外用样例库「星落镇」的真实文件跑一遍；`tests/contract/plugin-text.test.ts` 检查它们交给外壳的文字在每个界面语言里都有译文。

## 信任模型

- 插件的服务端部分运行在服务进程里，拥有与服务相同的文件与网络权限；网页部分运行在外壳页面里。**没有沙箱。**只安装来源可信的插件。
- 插件安装在运行服务的那台电脑上，不随资产库分发；打开别人的资产库不会执行任何代码。
- 第一期没有访问控制：打开局域网访问后，局域网里任何人都能在那台电脑上安装插件，也就是运行任何程序。
- 插件出错不会拖垮服务：内核单独拦截每一次调用，把对应任务标为失败；查看器被错误边界包住，崩溃时显示错误信息与「下载原文件」。
- 网页原型类内容（HTML 文档）要在 `sandbox="allow-scripts"`、**不带** `allow-same-origin` 的框架里运行，让它拿不到外壳页面和 Bowerbird 的接口（ADR-043）；文档插件就是这样做的。

## 内置插件的约定

写类似格式的插件时可以沿用：

| 插件 | 约定 |
|------|------|
| 图片 | 角标「宽×高」；`analysis.palette` 为主色（`{ hex, share }[]`）；动图的 `thumb` 是第一帧，缩小的动图存为 `scrub` 变体供网格悬停播放 |
| 视频 | 角标「0:03」；缩略图在浏览器渲染：`poster`（时长十分之一处）、`thumb`、`scrub`（25 帧，5 × 5 拼图）；解不了的编码抛 `retryable: false` |
| 音频 | 角标「0.8 秒」「2:14」；`tech.loudness`（LUFS）、`tech.peak`（dBFS）；`peaks` 变体为 JSON：`{ version, duration, sampleRate, channels, length, min[], max[], clips[], peak, loudness }`；`analysis.clips` 为削波位置（秒） |
| 文档 | `tech.title`、`words`、`lines`；Markdown front matter 的 `size:` 提取为 `targetWidth / targetHeight / targetDepth`（米）；`analysis.title` 与 `analysis.excerpt` 是网格文字单元的标题与开头几行；Markdown 里的相对图片路径作为位置名 |
| 关键词搜索 | 全文索引在 `dataDir/keyword.sqlite`（SQLite FTS5，trigram）；名称列同时放不带后缀与带后缀的文件名，完整文件名精确命中排第一；索引与查询两侧都做 NFKC 与小写规整，高亮区间对应原文；不足三个字的词按子串匹配 |
