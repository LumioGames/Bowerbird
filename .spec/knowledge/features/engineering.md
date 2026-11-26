---
name: engineering
description: 工程结构——技术选型、代码库的包划分与依赖方向、构建与分发、配置、日志、测试策略与性能基准；搭建工程、加新包或定测试方式时查
metadata:
  type: doc
  status: 已交付
---

# 工程结构

Bowerbird 用 TypeScript 写成，服务端、网页、插件、命令行共用一种语言，放在同一个代码库里。本文档说明选用了什么技术、代码怎么分包、怎么构建分发、怎么测试。

## 背景 / 目标

- 插件同时有服务端部分和网页部分，两者用同一种语言才便于编写。
- 查看器的渲染代码要能复用于缩略图生成。
- 源码公开，使用者要能一条命令装好并启动。
- 内核逻辑复杂的部分是对账规则与关系完整性，必须有自动化测试保护。

## 设计

### 技术选型

| 部分 | 选择 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.9 | 全部代码，严格模式；Node 包用 NodeNext 解析，网页用 Bundler 解析 |
| 服务端运行时 | Node.js 22（`>=22.12`） | 原生模块生态成熟 |
| 服务端框架 | Fastify 5 | 加 `@fastify/static`（托管外壳）、`@fastify/multipart`（上传）；导出压缩包用 yazl |
| 请求与数据校验 | zod 4 | `schema` 包里的同一份结构定义，服务端拿来校验，客户端拿来推导类型 |
| 索引 | SQLite，`better-sqlite3` 12 | 同步接口、带 FTS5，各平台有预编译包（ADR-031）。全文索引在关键词搜索插件自己的数据库里（ADR-028） |
| 文件监听 | Node.js 自带的 `fs.watch` | macOS、Windows 整库一个递归监听；其他系统逐个文件夹监听、有上限；定时扫描兜底（ADR-052） |
| 图片处理 | sharp 0.34 | 图片缩略图、音频波形图、样例生成 |
| 网页框架 | React 19 | 加 react-router 7、TanStack Query 5（查询缓存与失效）、TanStack Virtual 3（网格虚拟滚动） |
| 网页构建 | Vite 7 | 外壳；插件的网页模块用 esbuild 打包（见下） |
| 界面基础件 | shadcn/ui | 基于 Radix UI；放在 `plugin-sdk` 里，外壳与插件共用 |
| 界面动效 | Magic UI | 基于 motion，取用了 4 个效果 |
| 样式 | Tailwind 4 | 设计系统的变量照用；插件用 `@tailwindcss/cli` 编译自己用到的工具类 |
| 图标与提示条 | lucide-react、sonner | |
| 3D 渲染 | three.js 0.180 | 只在 3D 模型插件里，打进插件的网页模块 |
| 命令行 | commander 14 | |
| MCP | 官方 TypeScript SDK | |
| 包管理 | pnpm 10 工作区 | 单代码库多包 |
| 测试 | Vitest 3（jsdom、Testing Library）、Playwright | 单元与集成、浏览器端 |
| 许可证 | PolyForm Shield 1.0.0，另加 LumioGames 的附加许可和商标说明；写插件用的 `plugin-sdk`、`plugin-build`、`schema` 三个包按 MIT | ADR-058、ADR-059；第三方组件见 `THIRD_PARTY_NOTICES.md`（`pnpm notices` 按构建结果生成） |

### 代码库结构

```text
bowerbird/
├── packages/
│   ├── schema/            数据结构定义：元数据文件、查询模型与文本语法、接口请求与响应、事件、插件清单、客户端
│   ├── core/              内核：资产库读写、扫描对账、关系、任务管线、索引与查询、插件宿主
│   ├── server/            HTTP API、事件流、托管构建好的外壳、保存浏览器交回的缩略图
│   ├── plugin-sdk/        插件接口类型、基础组件与主题变量、测试工具
│   ├── plugin-build/      插件构建工具 bowerbird-plugin-build（插件作者的开发依赖，不随使用者安装）
│   ├── web/               网页外壳（私有包，只以构建产物发布）
│   ├── cli/               命令行 bb
│   ├── mcp/               MCP 服务
│   └── bowerbird/         发布到 npm 的主包：命令 bb，带内置插件与构建好的外壳
├── plugins/
│   ├── image/
│   ├── video/
│   ├── audio/
│   ├── model/
│   ├── doc/
│   └── search-keyword/
├── fixtures/              样例资产库与生成脚本；plugins/forge 是只用于测试的创建插件
├── tests/                 插件契约测试（contract/）与性能基准（perf/）
├── scripts/               仓库级脚本：按构建结果生成第三方组件通知（third-party-notices.mjs）、打包时复制许可文件（copy-legal.mjs）
├── e2e/                   浏览器测试（Playwright 配置与启动服务的辅助代码）
├── design/                交互原型与设计系统
├── docs/                  使用文档（usage.md）与插件开发文档（plugin-development.md）
├── Dockerfile
└── .spec/                 设计文档与决策记录
```

**包的职责与依赖方向**

| 包 | 依赖 | 不得依赖 |
|----|------|----------|
| `schema` | 无 | 任何其他包 |
| `core` | `schema`；`plugin-sdk` 只引用类型（`import type`） | `server`、`web`、任何具体插件 |
| `plugin-sdk` | `schema`（运行时只依赖它；React 是可选的同级依赖） | `core` 的内部实现 |
| `plugin-build` | `plugin-sdk`（读主题与共享模块列表）、构建工具 | 只在构建时使用，任何包都不在运行时依赖它 |
| `server` | `core`、`schema` | `web` 的源码、任何具体插件 |
| `web` | `schema`、`plugin-sdk` | `core`、`server` |
| `cli` | `server`、`core`、`mcp`、`schema` | `web` 的源码 |
| `mcp` | `schema` | `core`；只通过 HTTP API 访问 |
| 各插件 | `plugin-sdk`、`schema`；构建时 `plugin-build` | `core`、`server`、`web`、其他插件 |

两条硬约束：

1. **内核不引用任何具体插件**。内置插件通过与第三方相同的发现机制加载。
2. **插件只依赖插件开发包**。插件用不到内核的内部接口，接口不够时改插件开发包，不开后门。

`core` 内部按模块划分目录：
- `library`：磁盘读写；
- `scanner`：扫描、对账与文件监听；
- `model`：资产、关系、生产记录与写锁；
- `integrity`：完整性问题；
- `pipeline`：任务管线与缓存；
- `index`：索引表；
- `query`：查询、排序、分面与结果融合；
- `plugins`：插件宿主；
- `service`：一个资产库的全部操作。

顶层的 `hub` 管理多个资产库与本机配置，`log` 写运行日志。

**界面组件由 `plugin-sdk` 提供**。外壳与插件共用同一套基础组件（shadcn/ui）、动效（Magic UI）与主题变量，都从 `plugin-sdk` 取用，插件界面与外壳风格一致。设计系统里手写的组件样式只作长相的参照，不直接使用。

**插件网页模块的构建与共享运行时**（ADR-030）：
- 插件构建工具 `@bowerbird/plugin-build` 提供命令 `bowerbird-plugin-build`，插件把它装成开发依赖：
  - 把网页入口打成一个浏览器 ES 模块；
  - 用共同的主题编译插件自己用到的 Tailwind 工具类，在模块加载时注入一段 `<style data-bb-plugin="<插件标识>">`。
- 下面这些模块不打进插件，运行时从外壳挂在 `globalThis.__bowerbird_shared__` 上的实例读取：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@bowerbird/plugin-sdk/web`。
- 内置插件的构建命令是 `tsc -b && bowerbird-plugin-build`，与第三方插件相同；关键词搜索插件没有网页部分，只跑 `tsc -b`。
- 插件的 `dependencies` 只写服务端代码运行时加载的包；网页部分用到的库（three、markdown-it 等）打进模块，写在开发依赖里。所以使用者安装 `bowerbird` 时不会装上构建工具、React 或网页库。

**模型插件支持的格式**是 GLB、glTF、FBX。OBJ 不支持，按未知格式显示。

### 构建与分发

- **主包**（ADR-050）：
  - `bowerbird` 主包只做包装：依赖 `@bowerbird/cli`，包内带 `plugins/`（六个内置插件的构建结果）与 `web/`（构建好的外壳）；
  - 装好后可以用 `bb` 或 `bowerbird` 命令；
  - `@bowerbird/*` 各包用同一个版本号一起发布；
  - 命令行已经支持主包里的这种目录结构；在代码库里运行时，用 `packages/web/dist` 与 `plugins/*`。
- **插件开发包**：`@bowerbird/plugin-sdk` 供第三方插件依赖，带接口类型、界面组件与测试工具；构建工具单独成包 `@bowerbird/plugin-build`，插件作者装成开发依赖。插件接口的版本是清单里的整数 `apiVersion`，当前为 1。
- **Docker 镜像**：
  - 基于 `node:22-bookworm-slim`，构建阶段 `pnpm install`、`pnpm build`，再只保留运行依赖；
  - 卷 `/library`（资产库）与 `/data`（本机数据目录，`BOWERBIRD_HOME=/data`）；
  - 端口 7420，健康检查请求 `/api/v1/health`；
  - 默认命令 `serve /library --host 0.0.0.0 --port 7420`。
- **不带浏览器**：主包与镜像里都不带浏览器，服务端不渲染。需要渲染的缩略图由打开页面的浏览器生成后交回服务保存。
- **使用文档**：`docs/usage.md` 写安装、启动、多个资产库、局域网与安全、命令行、MCP、HTTP 接口、Docker 部署；`docs/plugin-development.md` 写插件开发。
- 桌面应用与手机应用不在第一期。

### 配置

配置分三层，后者覆盖前者：

| 层 | 位置 | 内容 |
|----|------|------|
| 资产库设置 | `<资产库>/.bowerbird/library.json` | 随库走的设置：需要的插件、默认阶段、Agent 搜索范围、回收站保留天数（`settings.trashDays`，默认 7）、插件设置里随库走的项、忽略的问题 |
| 本机配置 | `<本机数据目录>/config.json` | 监听地址与端口、已登记的资产库（`libraries`）、按库覆盖的缓存目录（`cacheDirs`）、扫描间隔（`scanIntervalMinutes`）、并发数、允许的来源（`allowedOrigins`）、插件设置里只在本机的项、按路径安装的插件（`installed`） |
| 启动参数与环境变量 | 命令行 | `--host`、`--port` 只作用于这一次运行，不写入本机配置；`BOWERBIRD_HOME` 决定本机数据目录在哪 |

- **插件的设置项**在清单里用 `scope` 声明存放在哪：随资产库走的写进资产库设置，只在本机的写进本机配置。字段的写法见 [`plugin-system.md`](plugin-system.md)。
- **涉及密钥的设置**（例如 AI 服务的访问凭据）：
  - 在清单里声明为本机、只写（`writeOnly`），存在本机配置里，不写入资产库；
  - 接口读出时只给占位 `{ "set": true }`（ADR-049）。
- **默认值**：监听 `127.0.0.1`，端口 `7420`；定时扫描每 10 分钟一次；回收站保留 7 天。本机数据目录默认是 `~/.bowerbird`。
- 环境变量的完整列表见 [`api-and-agent.md`](api-and-agent.md) 的命令行一节。

### 启动

- `bb serve <资产库目录>` 启动服务：
  - 目录不存在时先创建；
  - 命令里给出的目录登记到本机配置的 `libraries` 里，并作为这次打开的资产库。
- 一个服务可以登记多个资产库，各自是一个根文件夹，在界面上切换；切换只影响当前浏览器。索引按库分开存放在本机数据目录。与资产库内容有关的接口路径以 `/libraries/{library}` 为前缀，网页路由同样带上库的标识，见 [`api-and-agent.md`](api-and-agent.md) 与 [`web-shell.md`](web-shell.md)。
- `bb serve` 只托管构建好的外壳（ADR-050）：找不到时只提供接口，并提示先运行 `pnpm build`。
- 默认只监听本机。对其他机器开放要显式指定 `--host`，启动时打印局域网警告；没有访问控制插件时不做访问限制，见 [`api-and-agent.md`](api-and-agent.md) 的安全一节。

### 本机数据目录

```text
~/.bowerbird/
├── config.json
├── logs/bowerbird-YYYY-MM-DD.log
├── plugins/                       按包名安装的插件（npm install --prefix）
├── libraries/<库>/index.sqlite    每个资产库的索引
├── libraries/<库>/plugins/<插件>/  插件数据目录（ADR-028）
└── tmp/<插件>/                     插件临时目录
```

缓存默认在资产库的 `.bowerbird/cache/` 里，可以用本机配置的 `cacheDirs` 按库改到别处。

### 日志与可观测

- 日志是一行一条的 JSON（`at`、`level`、`module`、`msg` 与附加字段），按天（UTC 日期）写到本机数据目录的 `logs/` 下，不自动清理。
- 只按级别过滤：`BOWERBIRD_LOG_LEVEL` 取 `debug`、`info`（默认）、`warn`、`error`。服务运行时不往控制台写日志。
- 排查大库的内存时设 `BOWERBIRD_SCAN_MEMTRACE=1`：扫描的每一步（遍历、算指纹、读元数据文件、对账、完整性重算、入队）各记一行 `scan memory`（常驻内存、JS 堆等，单位 MB），扫描期间与之后每 2 秒也记一行。十万资产首次打开的常驻内存峰值约 300 MB。
- 每个写操作在运行日志里留一行，只用于排查问题。内核不记改动历史，这一行只在本机的日志里，不进资产库。
- 不记录文件内容与任何凭据。
- 设置页的任务分区显示：
  - 创建任务；
  - 管线各阶段的排队数与处理速度（没有插件处理的阶段不显示）；
  - 扫描进度；
  - 失败的任务与原因。
- 健康检查 `GET /api/v1/health` 返回服务状态、版本，以及每个资产库的状态、索引状态与扫描进度。扫描进度由多库管理直接给出，不去问管线的任务概况。

### 测试策略

| 层次 | 对象 | 方法 |
|------|------|------|
| 单元 | 元数据文件解析与写出、查询解析、缓存键、文本语法 | 纯函数测试，与源码放在一起的 `*.test.ts` |
| 内核集成 | 扫描对账、复制移动删除、关系完整性、版本记录、文件监听、大规模扫描 | 在临时目录里搭建资产库，执行文件操作，断言元数据文件、索引与问题列表 |
| 插件契约 | 每个格式插件 | `tests/contract/` 用同一套契约测试（`plugin-sdk` 的测试工具）跑遍所有内置插件，输入样例文件，断言识别、提取、缩略图的结果结构 |
| 接口 | HTTP API | 启动服务，按端点测试请求、错误码与安全规则 |
| 命令行与 MCP | `bb`、MCP 工具 | 对真实服务跑命令与工具调用 |
| 浏览器 | 查看器、缩略图的懒加载渲染与交回、关键流程 | Playwright（Chromium，1440×900，深色，中文），每个测试文件在样例库的副本上启动构建好的 `bb serve`，与原型截图比对并做交互断言 |
| 性能 | 扫描、查询、网格 | 用生成的十万资产样例库跑基准，与性能目标对照 |

**必须覆盖的对账场景**：
- 对账规则 R1 到 R12 每条至少一个测试；
- 复制的每条语义；
- 被引用资产的删除与恢复；
- 索引清空后重建的结果与重建前一致。

**收口命令**：

| 命令 | 作用 |
|------|------|
| `pnpm install && pnpm build && pnpm test` | 安装、全仓构建（`packages`、`plugins`、`fixtures/plugins`），跑全部 Vitest 测试：先跑 `node` 与 `web` 两个项目（测试直接引用源码，不必先构建），再单独跑 `bench` 项目里的计时断言（十万规模的查询、关键词、任务队列与扫描），一个文件跑完再跑下一个，不和其他测试抢 CPU；单独跑用 `pnpm test:bench` |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm e2e` | 浏览器测试，先 `pnpm build` |
| `node tests/perf/run-perf.mjs [--count N] [--keep] [--skip-web]` | 性能基准，先 `pnpm build`，需要 Chromium；结果写到 `tests/perf/results.json` |

**样例数据**：样例资产库不放进仓库，下载下来是干净的；`pnpm test`、`pnpm e2e` 先运行 `scripts/ensure-fixtures.mjs`，缺少或生成脚本有变化时重新生成（`pnpm fixtures` 强制重新生成；需要 ffmpeg 编码视频与音频）。生成是确定的，同一份脚本逐字节得到同样的文件。
- `fixtures/xingluo/`：「星落镇」样例资产库，是原型数据的副本，含断链、重复身份、冲突副本等情况。
- `fixtures/upload-batch/`：上传用的一批文件。
- `fixtures/plugins/forge`：只用于测试的创建插件，假的 AI 生成，不联网，不发布。
- 十万资产的性能样例库由 `pnpm perf` 生成。
- 全部样例都由 `fixtures/scripts/` 里的脚本生成，可以随源码一起分发；不手改生成的文件。
- 服务要跑在 `copy-library.mjs` 复制出的副本上，不直接打开提交进仓库的样例库。

### 性能基准

以十万个资产的库为基准。样例库由脚本生成，文件都很小，测的是数量带来的开销：

| 项目 | 目标 |
|------|------|
| 增量启动扫描（无变化） | 30 秒内 |
| 索引完全重建 | 以指纹计算速度为上限，过程中服务可用 |
| 单个文件变化到事件发出 | 2 秒内 |
| 服务常驻内存 | 500 兆字节以内 |

查询与界面的性能目标分别见 [`search.md`](search.md) 与 [`web-shell.md`](web-shell.md)。基准程序一并测这些目标，只打印对照结果，不因未达标而失败。

### 代码约定

- 所有跨包的数据结构定义在 `schema` 包里，其他地方不重复定义。
- 对资产库的写入只发生在 `core` 的 `library` 模块里，其他模块通过它落盘，库内的缓存文件也一样。
- 元数据文件的写入一律采用「写临时文件再改名」。
- 写锁内不等扫描，管线、查询、版本提交在锁外运行（ADR-051）。
- 插件调用一律经过宿主的统一封装，在其中拦截异常与计时。
- 界面一律用 `plugin-sdk` 提供的基础组件与主题变量，样式用 Tailwind 书写。
- 代码与注释用英文。
- 面向使用者的文字用中文：
  - 网页外壳的文字外置为多语言资源，语言列在 `@bowerbird/schema` 的 `LOCALES`（简体中文、英文、日文、韩文，ADR-061），每份词典的键与中文一致；
  - 命令行、MCP 与服务端返回的说明只有中文。

## 待解决

- 是否提供单文件可执行程序的分发形式，放到第一期之后评估。

## 相关

- 包与模块对应的功能设计：[`overview.md`](overview.md) 的模块地图。
- 插件开发包的接口：[`plugin-system.md`](plugin-system.md)。
- 决策：ADR-002、ADR-003、ADR-010、ADR-016、ADR-021、ADR-022、ADR-024、ADR-025、ADR-026、ADR-028、ADR-030、ADR-031、ADR-049、ADR-050、ADR-051、ADR-052。
- 已有答案的原待解决项：SQLite 绑定见 ADR-031；内置环境在代码里生成、不带 HDRI 文件，见 ADR-056；样例素材全部由脚本生成。
