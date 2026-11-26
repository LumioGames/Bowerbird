---
name: plugin-system
description: 插件系统——插件包结构、清单字段、生命周期、十二类扩展点的接口、安装更新、版本兼容与信任模型；写插件或改扩展点接口时查
metadata:
  type: doc
  status: 已交付
---

# 插件系统

Bowerbird 的内核不认识任何文件格式、AI 服务或版本控制系统，这些能力全部由插件提供。插件系统规定一个插件长什么样、能往哪些地方扩展、如何被加载。

## 背景 / 目标

- 增加一种格式的支持，只需要安装一个插件，不改内核、不升级内核。
- 使用者可以写自己的插件来承载团队规范。
- 内置插件用的接口和第三方插件完全一样，以此保证接口确实够用。
- 插件可以创建资产，但写入资产库只有内核这一条路。
- 插件出错不能拖垮服务。

## 设计

### 插件的构成

一个插件是一个 npm 包，由三部分组成，后两者都可选：

| 部分 | 运行位置 | 作用 |
|------|----------|------|
| 清单 | — | 声明标识、版本、提供哪些扩展点、处理哪些后缀、需要哪些设置 |
| 服务端部分 | Node.js 进程内 | 识别、提取信息、生成缩略图、搜索、校验、创建资产、调用外部工具、提供自己的接口 |
| 网页部分 | 浏览器 | 查看器、对比视图、渲染函数、界面面板 |

### 清单

清单写在 `package.json` 的 `bowerbird` 字段里，结构定义在 `packages/schema` 的 `manifest.ts`：

```jsonc
{
  "name": "@bowerbird/plugin-model",
  "version": "1.0.0",
  "bowerbird": {
    "id": "bowerbird.model",              // 全局唯一的插件标识，小写字母、数字、点、下划线、连字符
    "displayName": "3D 模型",
    "description": "GLB、glTF、FBX 的查看与对照",   // 可选
    "apiVersion": 1,                      // 所用的插件接口版本
    "server": "./dist/server.js",         // 服务端入口，可选
    "web": "./dist/web.js",               // 网页入口，可选
    "contributes": {
      "formats": [
        {
          "id": "model",
          "displayName": "3D 模型",
          "extensions": [".glb", ".gltf", ".fbx"],
          "priority": 100,
          "thumbnail": "browser"          // server / browser / none
        }
      ],
      "validators": [{ "id": "size-vs-design" }],   // 运行时登记的扩展点在这里声明标识
      "relationTypes": [],                // 每项 { id, name, inverseName, tracksVersion }
      "settings": {                       // JSON Schema，描述本插件的设置项
        "type": "object",
        "properties": {
          "defaultEnvironment": {         // 查看器默认使用的环境
            "type": "string",
            "scope": "library"            // 随资产库走
          },
          "maxPixelRatio": {              // 渲染时的像素比上限
            "type": "number",
            "scope": "machine"            // 只在本机；不写 scope 时也是 machine
          }
        }
      }
    },
    "requires": {
      "tools": []                         // 依赖的外部命令行工具，缺失时给出提示
    },
    "rateLimit": 60,                      // 可选：调用外部服务的任务每分钟上限
    "sourceLocale": "zh-CN",              // 可选：插件自己的文字用什么语言写，默认简体中文
    "l10n": {                             // 可选：交给外壳显示的文字的译文，语言 → 原文 → 译文（ADR-062）
      "en": { "Spine 动画": "Spine animation", "生成中 {pct}%": "Generating {pct}%" },
      "ja": { "Spine 动画": "Spine アニメーション" }
    }
  }
}
```

- `contributes` 里出现哪个键，就表示插件提供了哪类扩展点：
  - 格式写全声明（后缀、优先级、缩略图在哪生成）；
  - 搜索、富化、入库来源、创建、校验、模板、动作、访问控制写成 `[{ "id": … }]`；
  - 版本存储写 `{ id, displayName, ignore? }`。
- 内核只根据清单决定加载什么，不扫描代码。运行时登记的实现只对格式核对清单。

**设置项存放在哪**：每个设置项用 `scope` 标明。`library` 随资产库走，写进资产库设置；`machine` 只在本机，写进本机配置。缺省为 `machine`。访问凭据一类的设置应当声明为 `machine`，不写入资产库。

**多种语言**（ADR-061、ADR-062）：
- 插件网页部分自己的文字用插件开发包的 `defineMessages` / `useMessages` 写，中文必有，其他语言可选，缺的按当前语言 → 英文 → 中文回退。
- 插件交给外壳显示的文字，翻译写在清单的 `l10n` 里，按原文查：清单里的名字、说明、设置项标题与下拉选项名（JSON Schema 的 `enumNames`），以及 `activate` 里登记的创建方式与动作的名字、参数表单、输入角色、界面插槽标题、任务消息。
  - 原文里可以带 `{name}` 占位符，匹配会变的消息。
  - 内核只把 `l10n` 与 `sourceLocale` 原样带到 `PluginInfo` 上，由外壳按当前语言显示。
- 服务端写下、外壳显示的文字（网格角标、校验说明）由插件的网页部分按语言说出来，见下文「网页接口」的 `formatBadge` 与 `validators`。

**只写设置**：设置项加 `"writeOnly": true`（例如密钥）时，接口读出只给占位 `{ "set": true }`，写入时收到这个占位或省略就保留原值，给 `null` 清空（ADR-049）。设置页据此只显示「已设置」，不回显内容。

### 扩展点一览

| 扩展点 | 清单键 | 作用 | 第一期是否有内置实现 |
|--------|--------|------|----------------------|
| 格式 | `formats` | 识别文件、提取信息、缩略图、摘要、查看器、对比视图 | 有：图片、视频、音频、模型（GLB、glTF、FBX）、文档 |
| 搜索 | `searchProviders` | 把查询词变成带分数的资产列表 | 有：关键词 |
| 富化 | `enrichers` | 入库时自动补充标签、描述、向量 | 无 |
| 入库来源 | `sources` | 从外部把资产送进库 | 无；网页上传与接口推送属于内核 |
| 创建 | `creators` | 由人或 Agent 发起一次创建，产出登记为资产 | 无 |
| 校验 | `validators` | 按规则检查资产并给出结论 | 有：模型插件带一条尺寸对照 |
| 模板 | `templates` | 规定某类设计对象应有的字段与关联资产 | 无 |
| 动作 | `actions` | 对选中的资产执行操作 | 无 |
| 界面 | `ui` | 向外壳的插槽添加面板、页签、按钮、页面 | 随格式插件提供 |
| 版本存储 | `versionStore` | 保存与读取旧版本内容 | 无 |
| 关系类型 | `relationTypes` | 登记新的关系类型 | 无 |
| 访问控制 | `auth` | 在每个请求进入时识别是谁，并决定是否放行 | 无；内核已在每个接口请求上调用 |

入库来源、动作与创建都能让新资产进库，分工不同：入库来源是常驻运行的；动作是对选中的资产执行操作；创建是使用者发起的一次创建，不需要先选中什么。

### 服务端接口

以下用 TypeScript 摘录主要接口，完整定义以 `@bowerbird/plugin-sdk` 的 `server.ts` 为准。

**插件入口**

```ts
export interface ServerPlugin {
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(): Promise<void> | void
}
```

**上下文**：插件访问内核的唯一途径。

```ts
export interface PluginContext {
  readonly pluginId: string
  readonly pluginVersion: string
  readonly library: LibraryReader        // 只读查询资产、关系、生产记录
  readonly cache: CacheWriter            // 写入本插件产生的缓存文件
  readonly settings: SettingsReader      // 读取本插件的设置
  readonly log: Logger
  readonly dataDir: string               // 本机的插件数据目录：~/.bowerbird/libraries/<库>/plugins/<插件标识>/（ADR-028）
  readonly tmpDir: string                // 本机的插件临时目录：~/.bowerbird/tmp/<插件标识>/
  readonly events: {
    /** 订阅改动通知：哪个资产改了什么。接口已定，内核还不发 */
    on(event: 'asset.changed', handler: (change: AssetChange) => void): () => void
  }
  exec(tool: string, args: string[], opts?: ExecOptions): Promise<ExecResult>   // 调用外部工具
  register: {
    format(impl: FormatHandler): void
    searchProvider(impl: SearchProvider): void
    enricher(impl: Enricher): void
    source(impl: Source): void
    creator(impl: Creator): void
    validator(impl: Validator): void
    template(impl: Template): void
    action(impl: Action): void
    versionStore(impl: VersionStore): void
    auth(impl: AuthProvider): void
    route(impl: Route): void             // 本插件自己的服务端接口
  }
}
```

- 插件不能直接写元数据文件，也不能直接往资产库里写文件。需要修改资产信息时，通过各扩展点的返回值交给内核落盘；需要新增资产时，把登记结构交给内核。
- `dataDir` 与 `tmpDir` 都在本机、不进资产库，可以随时删掉重建。关键词搜索插件的全文索引就放在 `dataDir` 里。

**登记结构**：插件让新资产进库的唯一通道。入库来源、动作、创建三类扩展点都用它，字段与 `POST /assets` 的请求相同，见 [`api-and-agent.md`](api-and-agent.md)。

```ts
export interface RegisterRequest {
  file: FileInput                    // 文件内容，或资产库内已存在的路径
  folder?: string                    // 目标文件夹
  stage?: Stage                      // 物料阶段；缺省取文件夹的默认值
  tags?: string[]
  description?: string
  relations?: RelationInput[]        // 来源、引用、归属
  record?: RecordInput | string      // 生产记录，或已有记录的标识
  views?: ViewGrid                   // 四视图的格子信息
  onConflict?: 'replace' | 'keep-both' | 'skip'   // 目标位置已有同名文件时的处理
}
```

内核收到登记结构后完成其余的事：落盘、写元数据文件、写生产记录、建来源关系并记下输入当时的内容指纹、送入处理管线。经插件登记的生产记录，`plugin` 一项由内核填上插件标识与版本；执行者记发起的人或 Agent，不记插件。生产记录的字段见 [`data-model.md`](data-model.md)。

**格式**

```ts
export interface FormatHandler {
  id: string
  /** 读文件头确认是否认领；返回 null 表示不认领 */
  match(file: FileRef): Promise<MatchResult | null>
  /** 提取技术信息、文件里写着的位置名、可检索文本 */
  probe?(asset: AssetFile): Promise<ProbeResult>
  /** 生成网页预览用的转换文件 */
  derive?(asset: AssetFile): Promise<Derivative[]>
  /** 服务端生成缩略图；浏览器渲染的格式不实现此方法 */
  thumbnail?(asset: AssetFile): Promise<ThumbnailSet>
  /** 服务端生成 Agent 摘要的文字部分 */
  summarize?(asset: AssetFile): Promise<SummaryText>
}

export interface ProbeResult {
  tech: Record<string, number | string | boolean>   // 技术信息
  badge?: string                                    // 网格角标上的文本，例如「2,480 面」「0:03」「1024×1024」
  analysis?: Record<string, unknown>                // 分析结果，结构化数据，只进索引；例如图片的主色
  references?: string[]                             // 文件里写着的位置名，例如模型文件里的贴图文件名
  embedded?: string[]                               // references 里打包在文件内的那些，例如 GLB 里的图片
  text?: string                                     // 可检索的正文
  auxiliary?: boolean                               // 是否为附属文件
  aspect?: number                                   // 提取时就知道的缩略图宽高比
}
```

`references` 里的名字只表示「文件里有这样一个位置」，不表示引用的是谁。外部贴图名、`.bin` 文件名，以及打包在文件内的贴图的名字，都按位置名交给内核。位置对应哪个资产，由内核记在元数据文件里带 `slot` 的引用关系上，并以它为准：第一次读到时按文件名自动配上，之后重新提取不覆盖。`embedded` 里的名字照常配对，没配上时不算「引用的文件未找到」，因为文件里带着自己的一份。规则见 [`pipeline-and-cache.md`](pipeline-and-cache.md)。

浏览器渲染的格式在网页部分实现渲染函数（见下文「网页接口」）。渲染失败时可以抛出带 `retryable` 的错误：`false` 表示重试也没用（例如浏览器解不了这种编码），任务立即失败；不带时按可重试处理（ADR-052）。

**搜索**

```ts
export interface SearchProvider {
  id: string
  /** 资产入索引或更新时调用 */
  index(docs: SearchDoc[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** candidates 为已通过结构化筛选的资产集合；未提供时表示全库 */
  query(q: string, opts: { candidates?: IdSet; limit: number }): Promise<ScoredHit[]>
  /** 索引重建时清空；清空之后内核把所有资产重新喂给 index() */
  clear?(): Promise<void>
}

export interface ScoredHit {
  id: string
  score: number
  snippet?: { field: string; text: string; ranges: Array<[number, number]> }   // 名字以外的命中片段
}
```

搜索插件换了索引结构时要升版本号：启用的搜索插件这一组（插件@版本）一有变化，内核就把所有资产重新喂一遍（见 [`pipeline-and-cache.md`](pipeline-and-cache.md)「启动时找过期工作」）。

**富化**

```ts
export interface Enricher {
  id: string
  appliesTo(asset: AssetInfo): boolean
  enrich(asset: AssetFile): Promise<{ tags?: string[]; description?: string; vectors?: NamedVector[] }>
}
```

内核现在不保存 `vectors`；语义检索插件要用向量时，在自己的数据目录里存。

**校验**

```ts
export interface Validator {
  id: string
  appliesTo(asset: AssetInfo): boolean
  check(asset: AssetFile): Promise<CheckResult[]>
}

export interface CheckResult {
  rule: string                       // 规则标识
  verdict: 'pass' | 'warn' | 'fail'
  message: string
  values?: Record<string, unknown>   // 实测值，供界面显示
}
```

自动检查的结果只显示，不改变校验状态，通过还是打回由人决定；内置的与插件的检查都一样。内置的自动检查只有模型插件的尺寸对照一条。命名、贴图边长、面数上限这类合规检查不内置，由团队安装或编写校验插件。

**模板**

```ts
export interface Template {
  id: string
  displayName: string
  /** 判断一个资产是否是本模板描述的设计对象 */
  appliesTo(asset: AssetInfo): boolean
  /** 自定义字段的结构，JSON Schema */
  fields: JsonSchema
  /** 该设计对象应当挂有哪些关联资产 */
  slots: Array<{
    name: string
    relationType: string             // 通常为 belongs
    formats?: string[]
    stage?: Stage
    required: boolean
  }>
}
```

**动作**

```ts
export interface Action {
  id: string
  title: string
  appliesTo(selection: AssetInfo[]): boolean
  params?: JsonSchema
  run(selection: AssetInfo[], params: unknown, ctx: ActionContext): Promise<ActionResult>
}

export interface ActionContext {
  actor: string                      // 发起的人或 Agent
  log: Logger
  signal: AbortSignal                // 取消
}

export interface ActionResult {
  assets?: RegisterRequest[]         // 动作产出的新资产，由内核逐个登记
  message?: string                   // 完成时给使用者的一句话
}
```

- 动作的标识对外写成 `<插件标识>:<动作标识>`。
- `GET /actions?ids=…` 按 `appliesTo` 列出适用于所选资产的动作，`POST /actions/{id}/runs` 执行。
- 每次执行是队列里一个 `kind` 为 `action` 的任务，产出共用一条生产记录（ADR-052）。

**入库来源**

```ts
export interface Source {
  id: string
  /** 启动来源；通过 ingest 把文件送入资产库 */
  start(ingest: IngestFn): Promise<void>
  stop(): Promise<void>
}

/** 把一个文件交给内核登记，返回登记后的资产 */
export type IngestFn = (request: RegisterRequest) => Promise<AssetInfo>
```

入库来源的接口已经定下，内核现在还不调用 `start`。

**创建**

```ts
export interface Creator {
  id: string
  displayName: string
  /** 参数表单的结构，JSON Schema */
  params: JsonSchema
  /** 接受哪些输入资产 */
  inputs: Array<{
    role: string                     // 角色，例如参考图、蒙版、四视图；写进生产记录 inputs 的 role
    formats?: string[]               // 可接受的格式
    views?: boolean                  // 只接受四视图（元数据里有视图格子的资产，AssetSummary.hasViews）
    required: boolean
  }>
  /** 不用生成的表单，改为打开插件自己的页面（ui.pages 里的标识） */
  page?: string
  /** 执行一次创建 */
  run(request: CreateRequest, job: JobContext): Promise<void>
}

export interface CreateRequest {
  params: unknown                                    // 按 params 的结构填写的参数
  inputs: Array<{ role: string; asset: AssetInfo }>  // 发起时选定的输入资产
  folder?: string                                    // 表单里选的文件夹
  actor: string                                      // 发起的人或 Agent
}

export interface JobContext {
  readonly id: string
  /** 报告进度，取 0 到 1，可附一句说明；action 请使用者到插件页面做后续操作（ADR-042） */
  progress(value: number, message?: string, action?: { label: string; page: string; params?: Record<string, string> }): void
  /** 使用者取消时触发，插件应尽快停下 */
  readonly signal: AbortSignal
  /** 交出一个产出，由内核登记为资产 */
  register(output: RegisterRequest): Promise<AssetInfo>
}
```

- 内核不认识任何 AI 服务，也不区分「生图」「生成模型」，只知道这个插件能创建资产。
- 人和 Agent 都能发起。创建方式经接口列出、发起、查询，见 [`api-and-agent.md`](api-and-agent.md)。
- 每次发起是队列里的一个创建任务，不绑定资产，与处理任务出现在同一个任务列表里，见 [`pipeline-and-cache.md`](pipeline-and-cache.md)。
- 创建方式的标识对外写成 `<插件标识>:<创建方式标识>`。
- 一次运行可以登记零个、一个或多个产出。同一次运行的产出共用一条生产记录；没有任何产出的运行不写生产记录，只留在任务日志里。插件没带记录时，内核按 `method = <插件标识>/<创建方式标识>`、参数与输入补一条。
- 创建任务失败不自动重试，可以手动重试；取消后为 `cancelled`，之后再 `register` 会被拒绝；服务重启时进行中的记为失败（ADR-052）。
- 没挑中的产出不登记。候选文件放在插件的临时目录 `tmpDir` 里，不进资产库，不跟着同步，可以随时清理；内核不管候选产出。
- 需要使用者挑选时，`progress()` 带上 `action`，外壳在任务列表、顶栏后台处理与提示条上显示这个按钮，点了打开插件页面；挑中的由插件调用 `register` 登记。
- 需要自己界面的创建方式（例如无限画布）用界面扩展点登记页面，页面里调用的是同一个发起接口。
- 插件创作的文件也是普通资产。例如画布插件把画布存成库里的一个文件，并作为格式插件认领它：新建走登记，之后每次保存走替换内容的接口。

**访问控制**

```ts
export interface AuthProvider {
  id: string
  /** 每个请求进入时调用：识别是谁，并决定是否放行 */
  check(request: IncomingRequest): Promise<AuthDecision>
}

export interface IncomingRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  remoteAddress: string
  isLocal: boolean                   // 对端是回环地址且没有经过反向代理转发
}

export interface AuthDecision {
  allow: boolean
  actor?: string                     // 识别出的名字，作为执行者，例如 user:lin
  status?: number                    // 拒绝时的 HTTP 状态，默认 403
  message?: string                   // 拒绝时的说明
}
```

账号、密码、邮箱验证这类登录能力都放在访问控制插件里，内核不做。第一期没有带这样的插件；没有访问控制插件时所有请求都放行，执行者取自请求头。

**访问控制门**（ADR-049）：
- 内核对 `/api/v1/` 下除健康检查与预检之外的每个请求调用 `check`，外壳的静态页面不过门。
- 带 `{library}` 的接口只问这个库启用的访问控制插件。
- 全局接口（含插件自己的接口与网页模块）问所有可用资产库的访问控制插件，任一拒绝即拒绝。`?library=` 不能用来挑选把关的插件。
- 拒绝时返回错误码 `forbidden`，状态取插件给的值。插件抛出异常时请求失败，不放行。
- 第一个给出 `actor` 的插件决定执行者。

**插件自己的接口**

```ts
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string                       // 相对于 /plugins/{插件标识}/
  handler(request: RouteRequest): Promise<RouteResponse>
}
```

插件用 `register.route` 登记自己的服务端接口，例如按区域取大图的像素。
- 这些接口统一挂在 `/api/v1/plugins/{插件标识}/` 前缀下，与内核的接口由同一个服务提供，受同样的请求来源校验与访问控制。
- 路径可以带 `:名字` 参数。处理函数拿到请求的参数、查询、请求头、请求体、执行者、是否本机，以及所选资产库的只读接口。
- 内核在这个前缀下已有的路径（`web`、`settings`、`update`、`enable`、`disable`）不能被插件占用。
- 插件网页模块用到的其他文件（例如解码器），也经这个前缀取得。

**改动通知**：`ctx.events.on` 让插件订阅「哪个资产改了什么」。内核自己不记改动历史；需要「谁改了什么」「当时的关系是什么样」的团队，由插件订阅这类通知并自行保存。通知的结构 `AssetChange` 已定（资产、改了哪些字段、执行者、时间，可带改动前后的值），内核还不发。

**版本存储**：见 [`versioning.md`](versioning.md)。

### 网页接口

网页部分是一个 ES 模块，默认导出下面的结构，完整定义以 `@bowerbird/plugin-sdk/web` 的 `types.ts` 为准：

```ts
export interface WebPlugin {
  formats?: Record<string, FormatView>
  ui?: UiContributions
  /** 按校验器标识：把服务端写下的检查项名称与说明按界面语言说出来；没有或返回 null 时显示原文 */
  validators?: Record<string, { label?(check: CheckView, locale: Locale): string | null; message?(check: CheckView, locale: Locale): string | null }>
}

export interface FormatView {
  /** 查看器；mode 为 detail / quicklook / review / compare，说明在哪里显示 */
  Viewer: Component<{ asset: AssetDetail; source: FileSource; mode?: ViewerMode }>
  /** 对比视图；未提供时外壳用两个并排的 Viewer 代替。卷帘分界线由外壳绘制，位置经 split 传入；toolbar 是对比页顶栏里留给插件的位置（「技术信息」之前），插件自己的选项用 portal 放进去，没有时留在舞台上 */
  Compare?: Component<{ left: CompareSide; right: CompareSide; mode: CompareMode; split: number; toolbar?: HTMLElement | null }>
  /** 能否对比这两个资产（另一侧可以是别的格式），以及支持哪些模式；不支持的模式附原因，由外壳向使用者说明 */
  compareModes?(left: AssetDetail, right: AssetDetail): CompareModeSupport[] | null
  /** 自定义网格单元，用于悬停效果；未提供时显示缩略图 */
  GridCell?: Component<{ asset: AssetSummary; size: number; hover: { active: boolean; x: number }; thumbnail: string | null }>
  /** 渲染工作者调用，返回缩略图各变体、宽高比与在浏览器里读到的技术信息 */
  renderThumbnail?(asset: AssetDetail, source: FileSource): Promise<RenderedSet>
  /** 渲染工作者调用，返回 Agent 摘要图 */
  renderSummary?(asset: AssetDetail, source: FileSource): Promise<Blob>
  /** 对比页信息表里显示哪些技术信息，按顺序，带显示名 */
  techLabels?: Record<string, string>
  /** 检查器「技术信息」的行，代替每个键一行，例如「贴图 · 3 张 · 最大 1024」；对比页信息表仍按键列出（要算差值） */
  techRows?(asset: AssetDetail, locale: Locale): Array<[label: string, value: string]> | null
  /** 把提取时写下的角标（例如「2,480 面」）按界面语言说出来；没有或返回 null 时显示原文 */
  formatBadge?(badge: string, locale: Locale): string | null
}

export interface UiContributions {
  inspectorSections?: InspectorSection[]   // 检查器里的分区
  detailTabs?: DetailTab[]                 // 详情视图的页签
  toolbarItems?: ToolbarItem[]             // 顶栏按钮
  sidebarSections?: SidebarSection[]       // 左栏分区
  pages?: Page[]                           // 独立页面
  settingsPages?: SettingsPage[]           // 设置页
}
```

`FileSource` 让查看器既能读当前文件，也能读某个历史版本的文件，查看器本身不需要区分。
- 它能按位置名取依赖文件：查看器给出文件里写的名字（例如模型文件里的贴图文件名），`FileSource` 按元数据文件里 `slot` 对应的引用关系，返回对方资产的内容。所以关系更换之后显示的是新的对方，对方改名、移动也不受影响；资产文件本身不改。
- 它还给出包式资产里文件的地址。

`CompareMode` 取 `side`、`wipe`、`overlay`、`diff`，即并排、卷帘、叠加、差异。卷帘分界线的拖动、键盘微调与位置保持都由外壳负责，插件只按 `split` 绘制两侧，因此所有格式的卷帘操作一致。

**新建菜单项与右键菜单项**不在 `UiContributions` 里登记，外壳按服务端登记的内容生成：

- 新建菜单项来自创建方式（`register.creator`）。没有创建插件时顶栏是「上传」按钮；有创建插件时变成「新建」菜单，「上传文件…」排第一，后面是各创建方式。选中一项后，外壳按它声明的 `params` 与 `inputs` 显示表单并发起。
- 选中的资产符合某个创建方式的输入时，这个创建方式也出现在右键菜单里，例如选中四视图时出现「生成模型」。
- 右键菜单里其余的插件项来自动作（`register.action`），按 `appliesTo` 决定是否出现，排在「移入回收站」之前；带参数的动作名以「…」结尾，点击后显示与创建方式同一套的参数表单。
- 需要自己界面的创建方式用 `pages` 登记页面，外壳打开这个页面，不显示表单。

**界面组件**用 React 编写。外壳经 `@bowerbird/plugin-sdk` 向插件提供自己在用的那一套：shadcn/ui 的基础组件（按钮、菜单、对话框、弹出面板、表单、表格等）、Magic UI 的动效，以及主题变量（颜色、间距、圆角、动效时长）；样式用 Tailwind。插件与外壳共用这一套，插件界面与外壳风格一致，键盘操作与焦点管理由基础组件处理。插件的报错、提示与操作结果用外壳的通用提示条显示；插件还拿到外壳的接口（`ShellApi`），用来调接口、打开页面、弹提示条。

**构建与共享运行时**（ADR-030）：
- 构建工具 `@bowerbird/plugin-build`（插件的开发依赖）的命令 `bowerbird-plugin-build` 把网页入口打成一个浏览器 ES 模块。
- `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@bowerbird/plugin-sdk/web` 不打进模块，运行时用外壳挂在 `globalThis.__bowerbird_shared__` 上的同一份实例。
- 插件用到的 Tailwind 工具类按共同的主题编译，在模块加载时注入一段 `<style data-bb-plugin="<插件标识>">`。
- 内置插件与第三方插件走同一条构建与加载路径。

### 生命周期

1. **发现**：服务启动时，以及安装、更新插件时，从三个位置读取插件：随内核发布的内置插件目录、本机的 `~/.bowerbird/plugins/`（按包名安装的）、本机配置 `installed` 里按路径安装的。路径落在任何资产库里的插件标为失败、不加载（ADR-012）。
2. **校验**：检查清单是否完整、`apiVersion` 是否受支持。不通过的插件不加载，并在设置页的插件分区说明原因。
3. **启用判断**：资产库的 `library.json` 声明了需要哪些插件；本机已安装但未被声明的插件默认不启用。
4. **激活**：加载服务端入口，调用 `activate`，插件在其中登记自己的实现。`activate` 抛错时，插件列为「加载失败」并带上错误原因，设置页里能看到为什么。
5. **网页加载**：外壳从接口取得已启用插件的列表，按需动态加载各插件的网页模块。
6. **停用**：服务关闭或插件被禁用时调用 `deactivate`。

### 安装与更新

- 通过命令行：`bb plugin add <包名或路径>`、`bb plugin update`、`bb plugin remove`。
- 通过界面：设置页的插件分区列出已安装的插件、版本、状态，可以安装、更新、卸载、启用、禁用。安装时填 npm 包名，或服务所在那台电脑上的路径；路径在资产库里时拒绝。
- 启用与停用作用于所选的资产库。启用非内置插件时，它认领的后缀写进 `library.json` 的 `pluginFormats`（ADR-044）。
- 第一期不区分本机与其他电脑：打开局域网访问后，从其他电脑打开的页面同样可以安装、更新、卸载插件。
- 插件安装在运行服务的那台电脑上，不随资产库分发。
- 更新一个格式的支持只需更新对应插件。插件版本进入缓存键，更新后相关的缩略图与预览在下次服务启动时自动重做（ADR-052）。

### 版本兼容

- 插件接口由 `@bowerbird/plugin-sdk` 定义，遵循语义化版本。
- 清单里的 `apiVersion` 是接口的主版本号。内核同时支持当前主版本和上一个主版本。
- 接口只增加可选能力时不升主版本。
- 插件声明的 `apiVersion` 不受支持时拒绝加载，并给出明确提示。

### 信任模型

- 插件的服务端部分运行在服务进程内，拥有与服务相同的文件与网络权限；网页部分运行在外壳页面内。**没有沙箱**。
- 因此只应安装来源可信的插件。这一点写入使用文档与设置页的插件分区。
- 界面上可以安装插件，而第一期没有访问控制插件。打开局域网访问后，局域网里任何人都能在那台电脑上安装插件，也就是运行任何程序。打开局域网访问时的提醒写明这一点。
- 登录由访问控制插件提供，内核不做账号、密码与邮箱验证。第一期没有这类插件。
- 资产库不携带插件代码，打开别人的资产库不会执行任何代码；放在资产库里的插件不加载。
- 外壳页面的内容安全策略只允许本服务、`data:` 与 `blob:`，插件查看器无法让浏览器去请求资产文件里写着的外部地址（ADR-049）。
- 需要运行不受信任插件的使用者，要自行增加隔离。

### 错误隔离

- 内核对每一次插件调用单独拦截异常，记录日志，并把对应任务标为失败。
- 网页部分的查看器用错误边界包裹，查看器崩溃时显示错误信息和“下载原文件”，不影响外壳其余部分。
- 同一个插件连续失败超过阈值时，在设置页的插件分区给出警告，但不自动禁用。连续失败按工作类型分开计：创建、动作、插件页面调自己的接口、访问控制，其余（处理、搜索、版本存储、激活）算一类；只有同一类后来成功才清零，所以插件页面的轮询不会把创建失败的警告清掉。

## 待解决

- 插件之间是否需要依赖声明（例如对照视图插件依赖模型插件），第一期不支持，后续按需求评估。
- 改动通知什么时候发、发给谁，在实现第一个历史插件时确定；通知的结构已定，内核还不发。访问控制的接口已经接上，见上文。

## 相关

- 各阶段如何调用格式插件：[`pipeline-and-cache.md`](pipeline-and-cache.md)。
- 内置插件的具体行为：[`builtin-plugins.md`](builtin-plugins.md)。
- 外壳的插槽：[`web-shell.md`](web-shell.md)。
- 创建方式与插件管理的接口：[`api-and-agent.md`](api-and-agent.md)。
- 决策：ADR-003、ADR-010、ADR-012、ADR-016、ADR-018、ADR-019、ADR-020、ADR-021、ADR-022、ADR-023、ADR-024、ADR-028、ADR-030、ADR-031、ADR-042、ADR-044、ADR-049、ADR-052、ADR-056。
