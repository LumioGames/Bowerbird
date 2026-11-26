---
name: api-and-agent
description: 接口与 Agent——HTTP API 端点、错误模型、事件流、执行者留痕、MCP 工具、命令行、Agent 摘要与标签治理、监听地址与安全；对接 Agent 或改接口时查
metadata:
  type: doc
  status: 已交付
---

# 接口与 Agent

Bowerbird 对外只有一套 HTTP API。网页外壳、命令行、MCP 服务都是它的客户端，没有任何一方享有私有接口。面向 Agent 的 MCP 工具与命令行是对这套 API 的薄封装。请求与响应的结构定义在 `packages/schema` 的 `api.ts`，端点清单是其中的 `ENDPOINTS`。

## 背景 / 目标

- Agent 要能完成搜索、追溯、登记、修改、取用的完整闭环。
- Agent 的上下文有限，返回内容要精简，并且让它一眼看清资产的阶段与状态。
- AI 生产流程里，Agent 生成一个资产后要能一次性登记它的来源和提示词。
- 创建插件提供的创建方式，人和 Agent 都要能发起。
- 内核不做登录，所以默认必须是安全的。

## 设计

### 通用约定

- 基础路径 `/api/v1`。
  - 请求与响应一般是 JSON。
  - 上传用 multipart：登记资产是 `file` 加 `meta`（JSON），手动缩略图是 `image`，渲染结果是各变体。
  - 另有文件下载、事件流与导出压缩包。
  - 服务默认监听 `127.0.0.1` 的 `7420` 端口。
- 一个 Bowerbird 可以登记多个资产库。
  - 与资产库内容有关的接口，路径以 `/libraries/{library}` 为前缀，`{library}` 是库的标识。例如搜索的完整路径是 `/api/v1/libraries/{library}/search`。
  - 插件管理、本机配置、资产库列表这类全局接口不带前缀。
  - 全局接口需要知道「在哪个库上」时（例如启用插件），依次看请求头 `X-Bowerbird-Library`、查询参数 `?library=`、默认库。
- 资产一律用 GUID 标识。
- 执行者通过请求头 `X-Bowerbird-Actor` 提供：
  - 格式为 `user:<名称>` 或 `agent:<名称>`，名字有非 ASCII 字符时做百分号编码；
  - 名字 1 到 127 个字符，不含控制字符，不合规返回 `validation_failed`；
  - 没有提供时为 `user:unnamed`，界面显示为「未署名」；
  - 网页外壳用设置里填的名字；装了访问控制插件时，以插件识别出的名字为准（ADR-049）。
- 只有搜索用游标分页，其余列表一次返回全部。
- 时间为 UTC 的 ISO 8601 字符串。
- 内核不记改动历史。写操作只在本机的运行日志里留一行，用于排查问题；接口不提供「谁在什么时候改了什么」的查询。

**状态码**

| 状态 | 用于 |
|------|------|
| 200 | 一般的成功；登记时跳过了同名文件也是 200 |
| 201 | 新建：添加资产库、安装插件、登记资产、复制、新建生产记录、新建文件夹、把文件夹作为一个资产 |
| 202 | 先答复、后台继续：开始扫描、执行创建方式、执行动作 |
| 204 | 没有响应体：打开、在文件夹中显示、停止扫描、删除插件、彻底删除回收项、清空回收站、取消任务、重试任务、交回渲染结果 |
| 206 | 范围请求 |

**范围请求**：资产文件、缩略图、按位置名取文件、包内文件、插件网页模块支持。
- 只支持单个范围：`bytes=a-b`、`bytes=a-`、`bytes=-n`。多个范围或写法不合法时，忽略范围返回整个文件。
- 超出文件时返回 416 `range_not_satisfiable`，带 `Content-Range: bytes */<大小>`。
- 不处理 `If-Range`。
- 版本文件与导出压缩包不支持范围。

**错误模型**

```jsonc
{
  "error": {
    "code": "referenced",
    "message": "该资产被 3 个资产引用",
    "details": { "referrers": ["<GUID>", "<GUID>", "<GUID>"] }
  }
}
```

| 错误码 | HTTP 状态 | 含义 |
|--------|-----------|------|
| `not_found` | 404 | 资产、资产库或资源不存在；资产库文件夹现在访问不到 |
| `not_local` | 403 | 这个操作在服务所在的机器上执行，只接受那台机器发来的请求：打开源文件、在文件夹中显示（资产与资产库）、导出到目录 |
| `validation_failed` | 400 | 请求内容不合法；结构校验失败时 `details.issues` 列出各处问题 |
| `conflict` | 409 | 目标路径已存在、元数据文件已被别处改过等冲突 |
| `referenced` | 409 | 删除被拒绝，因为资产被引用 |
| `cycle` | 409 | 来源关系会成环 |
| `unsupported` | 501 | 需要的插件未安装，例如读取旧版本内容 |
| `read_only` | 403 | 资产库由更新版本的 Bowerbird 写过，只能只读打开 |
| `forbidden` | 403 | 主机头或来源头不被允许，或访问控制插件拒绝；状态可以由插件改为别的值（例如 401） |
| `range_not_satisfiable` | 416 | 范围请求超出文件 |
| `internal` | 500 | 未预期的错误 |

### 端点

前两张表写的是完整路径：资产库本身、本机配置与插件管理。其余各表都是资产库内的接口，路径一律省略了前缀 `/libraries/{library}`。

**资产库与本机配置**

| 方法与路径 | 作用 |
|------------|------|
| `GET /health` | 健康检查：服务状态、版本，以及每个资产库的状态、索引状态与扫描进度；不过访问控制 |
| `GET /libraries` | 已登记的资产库列表与默认库 |
| `POST /libraries` | 添加资产库：文件夹与名称；`create: true` 表示新建，文件夹已存在且里面有内容时返回 409 `conflict`（`details.reason: not_empty`） |
| `GET /fs/folders?path=` | 列出服务所在电脑上某个文件夹里的文件夹（选文件夹对话框）：只列文件夹，不读文件；以点开头的不列；标出已是资产库的；最多 2,000 个。只接受本机请求（ADR-049、ADR-063） |
| `GET /libraries/{library}` | 一个库的信息、统计、需要的插件、版本插件、文件监听状态、监听地址，以及当前请求是否来自服务所在的机器 |
| `PATCH /libraries/{library}` | 修改库设置，例如回收站保留天数 `trashDays` |
| `POST /libraries/{library}/init` | 首次打开已有文件的文件夹时开始登记；进度看 `scan.progress` |
| `POST /libraries/{library}/rescan/stop` | 停止扫描或登记，下次接着做 |
| `POST /libraries/{library}/reveal` | 在文件夹中显示资产库根文件夹，只接受本机请求 |
| `GET /config`、`PATCH /config` | 读写保存下来的本机配置：监听地址与端口、缓存目录、扫描间隔、并发数、允许的来源、插件的本机设置；读出时附带本机数据目录与是否需要重启（这次运行里改过只在启动时生效的项、且与这次运行用的不同；命令行参数不算） |

**插件**（全局接口，不带前缀）

| 方法与路径 | 作用 |
|------------|------|
| `GET /plugins` | 已安装插件及在所选资产库里的状态 |
| `POST /plugins` | 安装插件，给出 npm 包名或服务所在机器上的路径；路径在资产库里时拒绝 |
| `POST /plugins/{id}/update` | 更新 |
| `DELETE /plugins/{id}` | 卸载 |
| `POST /plugins/{id}/enable`、`POST /plugins/{id}/disable` | 在所选资产库里启用与停用 |
| `GET /plugins/{id}/settings`、`PUT /plugins/{id}/settings` | 读写插件只在本机的设置（`scope` 为 `machine`） |
| `GET /plugins/{id}/web` | 插件的网页模块 |
| `/plugins/{id}/…` | 插件自己登记的接口与网页资源，见 [`plugin-system.md`](plugin-system.md) |

**扫描、词表与缓存**

| 方法与路径 | 作用 |
|------------|------|
| `POST /rescan` | 触发扫描，可指定目录；返回 202 |
| `GET /vocabulary` | 词表：阶段、格式、关系类型、标签及其用量、模板 |
| `GET /cache` | 缓存占用 |
| `POST /cache/clean` | 清理没有对应资产的缓存文件；带 `all` 时清空缓存 |

**资产**

| 方法与路径 | 作用 |
|------------|------|
| `POST /search` | 搜索，请求体为查询模型，可要求分面 |
| `GET /assets/{id}` | 资产详情，含技术信息、分析结果、规则检查结果、两个方向的关系、没找到的位置名与相关问题 |
| `POST /assets/precheck` | 上传预检：给出目标文件夹与文件名，返回哪些会与已有文件同名 |
| `POST /assets` | 登记新资产：上传文件，或登记资产库内已存在的路径；可用 `onConflict` 指定同名时的处理 |
| `PATCH /assets/{id}` | 修改标签（按增删）、描述、阶段、自定义字段、附属标记、格子信息 |
| `DELETE /assets/{id}` | 移入回收站；被引用时需带 `force=true` |
| `POST /assets/{id}/content` | 替换内容，产生新版本 |
| `POST /assets/{id}/move` | 移动或改名，可带 `onConflict` |
| `POST /assets/{id}/copy` | 复制，返回副本与提示文字；原来指向原件的关系不变 |
| `POST /assets/{id}/review` | 提交校验结论；可带看到的内容指纹 `expectHash`，已被别人审过时返回 `conflict`（ADR-038） |
| `POST /assets/{id}/tags/accept` | 把指定的 AI 标签采纳为人工标签 |
| `POST /assets/{id}/tags/dismiss` | 移除指定的 AI 标签 |
| `GET /assets/{id}/file` | 原始文件，支持范围请求；`?download=1` 作为附件下载 |
| `GET /assets/{id}/slots/{slot}` | 按位置名取依赖文件（ADR-018） |
| `GET /assets/{id}/bundle/*` | 包式资产里的文件（ADR-043） |
| `POST /assets/{id}/open` | 用默认程序打开源文件，只接受本机请求 |
| `POST /assets/{id}/reveal` | 在文件夹中显示源文件，只接受本机请求 |
| `GET /assets/{id}/thumbnail` | 缩略图，`variant` 取 `thumb`、`preview`、`poster`、`scrub`、`peaks`、`turnaround`；带 `v` 时可以长期缓存 |
| `PUT /assets/{id}/thumbnail`、`DELETE /assets/{id}/thumbnail` | 写入与清除手动缩略图 |
| `GET /assets/{id}/summary` | Agent 摘要：文字与概览图 |
| `GET /assets/{id}/lineage` | 追溯，可指定方向、关系类型、深度 |
| `GET /assets/{id}/versions` | 版本记录 |
| `GET /assets/{id}/versions/{hash}/file` | 某个历史版本的文件内容，需要版本插件 |
| `POST /assets/{id}/versions/{hash}/restore` | 恢复为某个历史版本，需要版本插件 |
| `POST /assets/batch` | 批量修改，对多个资产应用同一组改动；资产可以逐个列出，也可以用一个查询指定（最多 1 万个）。总是返回 200，逐项列出成功与失败；`updated` 只列真的改了的资产，移动时因重名跳过的、目标就是原位置的，既不在 `updated` 也不在 `failed` |

**关系与生产记录**

| 方法与路径 | 作用 |
|------------|------|
| `POST /assets/{id}/relations` | 新增关系 |
| `DELETE /assets/{id}/relations` | 删除关系，以类型与对方 GUID 指定 |
| `POST /assets/{id}/relations/replace` | 更换关系：以关系类型与原对方指定一条关系，给出新对方 |
| `POST /assets/{id}/relations/acknowledge` | 确认已复核上游更新，把 `toHash` 更新为对方当前指纹 |
| `POST /relations/retarget` | 批量更换：把指向某个资产的关系全部换成指向另一个资产；默认只预览，`dryRun: false` 才执行；只给 Agent 用，界面上不出现 |
| `POST /records` | 新建生产记录 |
| `GET /records/{id}` | 读取生产记录 |
| `POST /records/{id}/notes` | 给生产记录追加备注 |

**文件夹、标签、视图**

| 方法与路径 | 作用 |
|------------|------|
| `GET /folders` | 文件夹树，含各自的资产数量、显示名、图标、备注、最近修改时间 |
| `POST /folders` | 新建文件夹 |
| `PATCH /folders` | 改名、移动；修改显示名、图标、备注与默认值 |
| `DELETE /folders` | 删除文件夹：其中的资产移入回收站；里面有资产被文件夹外引用时，不带 `force` 返回 `referenced`（ADR-047） |
| `POST /folders/bundle` | 把文件夹作为一个资产（包式资产），可指定入口文件 |
| `GET /tags` | 标签列表、定义与用量 |
| `PATCH /tags` | 改名、合并、修改分组与颜色 |
| `POST /tags/accept`、`POST /tags/dismiss` | 在全库范围采纳或移除某个 AI 标签，或全部 |
| `GET /views`、`PUT /views/{name}`、`DELETE /views/{name}` | 智能文件夹 |

**问题与回收站**

| 方法与路径 | 作用 |
|------------|------|
| `GET /issues` | 完整性问题列表，可按类型、级别、资产筛选；附带涉及的资产与资产个数 |
| `POST /issues/{id}/resolve` | 对一条问题执行指定的处理 |
| `POST /issues/resolve` | 对多条同类型的问题批量执行同一种处理，逐条列出成功与失败 |
| `GET /issues/{id}/candidates` | 「重新定位文件」可选的候选文件 |
| `GET /trash` | 回收站内容与保留天数 |
| `POST /trash/{id}/restore` | 恢复；原位置被占时默认改名，`rename: false` 时返回 `conflict` |
| `DELETE /trash/{id}` | 彻底删除 |
| `DELETE /trash` | 清空回收站 |

**创建、动作与任务**

| 方法与路径 | 作用 |
|------------|------|
| `GET /creators` | 列出创建方式：标识、显示名、参数表单、接受的输入资产及角色 |
| `POST /creators/{id}/runs` | 发起一次创建，给出参数、输入资产与目标文件夹，返回任务（202） |
| `GET /actions?ids=…` | 列出适用于所选资产的插件动作 |
| `POST /actions/{id}/runs` | 在所选资产上执行一个动作，返回任务（202） |
| `GET /jobs` | 各阶段的排队与速度、等待渲染的数量、扫描进度、失败的任务、创建任务、正在处理的任务 |
| `GET /jobs/{id}` | 查询一个任务：状态、进度、已登记的产出、插件请使用者做的后续操作 |
| `DELETE /jobs/{id}` | 取消任务 |
| `POST /jobs/retry` | 重试：指定资产与阶段，或全部失败的，或指定任务 |

创建方式与动作的标识写成 `<插件标识>:<标识>`。

**导出**

| 方法与路径 | 作用 |
|------------|------|
| `POST /export/plan` | 列出将写出的文件与大小，不写任何东西 |
| `POST /export` | 把一组资产导出：给了 `dir` 时复制到服务所在机器上的这个目录（只接受本机请求），否则流式返回压缩包下载。也接受普通表单（`ids`、`withDeps`、`layout`、`name`），供浏览器直接存盘；表单只能下载，不接受 `dir`（ADR-029） |

- 可以连同依赖一起导出（`withDeps`），可以保持目录结构或拍平（`layout`）。
- 带 `slot` 的引用按 `slot` 的名字写出。
- 导出目录必须是绝对路径，且不在资产库里。结果为 `{ written, dir, bytes, skipped? }`，`skipped` 列出不合法的位置名与会落到目录外的路径（ADR-048）。

**渲染与插件设置**

| 方法与路径 | 作用 |
|------------|------|
| `GET /render/next` | 渲染工作者领取任务，可带当前可见的资产优先 |
| `PUT /render/{job}` | 渲染工作者提交结果，可附带在浏览器里读到的技术信息 |
| `GET /plugins/{id}/settings`、`PUT /plugins/{id}/settings` | 读写插件随资产库走的设置（`scope` 为 `library`） |

**只写设置**：清单里标为 `writeOnly` 的设置项（例如密钥）读出时只给 `{ "set": true }`；写入时收到这个占位或省略这一项就保留原值，给 `null` 清空（ADR-049）。

**事件流**

`GET /events` 以服务器推送事件的方式持续发送这个资产库里的变化：

| 事件 | 含义 |
|------|------|
| `asset.created`、`asset.updated`、`asset.removed` | 资产的新增、变化、移除；`asset.updated` 带上变了哪些字段，`asset.removed` 带原因（回收站、缺失、彻底删除） |
| `asset.thumbnail` | 缩略图就绪 |
| `relation.updated` | 关系的新增、更换、删除、确认已复核 |
| `tags.updated` | 标签定义的变化 |
| `folder.updated` | 文件夹的新建、改名、移动、删除与设置变化 |
| `view.updated` | 智能文件夹的变化 |
| `trash.updated` | 回收站内容的变化 |
| `library.updated` | 库设置的变化 |
| `plugin.updated` | 插件的安装、更新、卸载、启用、禁用 |
| `job.updated` | 任务状态与进度的变化；处理任务首次就成功时节流发送，最多每 500 毫秒一条（ADR-052、ADR-060） |
| `issue.created`、`issue.resolved` | 完整性问题的出现与解决 |
| `scan.progress` | 扫描进度 |

- 连接时先发 `retry: 3000`。
- 每 15 秒发一行注释作为心跳。
- 积压超过 1 MiB 的慢客户端会被断开。
- 不带事件编号，断线后不补发，客户端重连后重新拉取。

### 登记资产

登记是 Agent 生产流程的核心操作，一次请求可以同时完成：

1. 上传文件到指定文件夹，或登记一个已经放进资产库的文件。
2. 设置阶段、标签、描述。
3. 建立关系：来源、引用、归属。
4. 附带一条生产记录：方式、工具、提示词、参数、输入资产。
5. 图片是四视图时，带上格子信息。

`POST /assets` 的请求内容（上传时放在 multipart 的 `meta` 部分）：

| 字段 | 说明 |
|------|------|
| 文件 | 随请求上传（multipart 的 `file` 部分），或用 `path` 给出资产库内已存在的路径 |
| `folder` | 目标文件夹 |
| `name` | 写出的文件名，缺省取上传的文件名；可以带子文件夹以保留目录结构 |
| `stage` | 物料阶段；缺省取文件夹的默认值 |
| `tags` | 标签 |
| `description` | 描述 |
| `relations` | 关系，每条含类型与对方 GUID，可带位置名 |
| `record` | 生产记录，或已有记录的标识 |
| `views` | 四视图的格子信息 |
| `review` | 给 `exempt` 时免审 |
| `onConflict` | 目标位置已有同名文件时的处理：`replace` 替换为新版本、`keep-both` 保留两者、`skip` 跳过；不带时返回 `conflict` |

- 用 `path` 登记一个已经有元数据文件的文件时，合并字段而不报冲突（ADR-051）。
- 插件登记产出时交给内核的登记结构 `RegisterRequest` 与这里的字段相同，见 [`plugin-system.md`](plugin-system.md)。
- 响应里包含新资产、是否跳过、生产记录的标识、被判定为新出现的标签，以及与这些新标签相近的已有标签。

**生产记录**

- `method` 是开放值。内置值见 [`data-model.md`](data-model.md)；插件自定义的值以插件标识作前缀。
- `inputs` 的每一项可以带 `role`，说明这个输入的角色，例如参考图、蒙版、四视图。输入当时的内容指纹由内核记下。
- `params` 约定三个常用键 `model`、`seed`、`negativePrompt`，其余键自由。切图时，切图工具或 Agent 把切图在效果图上的区域写进 `params.rect`（ADR-036）。
- `plugin` 由内核填写，值为插件标识加版本；库外生成后登记的记录没有它，请求里不用带。
- 记录里不列产出。同一次生产有多个产出时，先建一条生产记录，再让每个产出在登记时引用它。一条记录产出了哪些资产，由 `origin` 等于它的资产，加上来源关系的 `record` 指向它的资产反查（ADR-027）。

**四视图的格子信息**

四视图是一张完整的图片，各个视图按固定格子排布。登记时用 `views` 写明分成几行几列、每一格是哪个视图：

```jsonc
"views": { "rows": 2, "cols": 2, "cells": ["front", "side", "back", "top"] }
```

`cells` 按从左到右、从上到下的顺序，取值 `front`、`side`、`back`、`top`。格子信息由生成四视图的一方写入，内核把它存进元数据文件；程序不从图片上识别。没有格子信息的图片只能与模型并排对比。

### 创建与动作

创建方式由创建插件提供，人和 Agent 都能发起：

1. `GET /creators` 列出当前可用的创建方式，每个方式给出标识、显示名、参数表单（JSON Schema）、接受哪些输入资产（角色、可接受的格式、是否必需）。
2. `POST /creators/{id}/runs` 给出参数、输入资产与目标文件夹，返回一个任务。
3. `GET /jobs/{id}` 查询任务的状态、进度与已登记的产出；`DELETE /jobs/{id}` 取消。

- 创建任务不绑定资产，与处理任务在同一个队列里，失败了不自动重试。
- 产出由内核登记为资产，走的是与 `POST /assets` 相同的登记通道。一次运行可以登记零个、一个或多个产出。
- 插件没带生产记录时，内核补一条，`method` 为 `<插件标识>/<创建方式标识>`。
- 任务可以带一个后续操作（按钮文字与插件页面），外壳据此把人带到插件页面，例如挑选候选（ADR-042）。
- 执行者记发起的人或 Agent；是哪个插件做的，看生产记录的 `plugin`。
- Agent 可以调用库内的创建插件，也可以照旧在库外生成后调用 `POST /assets` 登记，两种方式留下的记录结构相同。
- 第一期不带任何创建插件，`GET /creators` 返回空列表。

插件动作作用于选中的资产：`GET /actions?ids=…` 列出适用的动作，`POST /actions/{id}/runs` 执行，结果是一个 `kind` 为 `action` 的任务，一次运行的产出共用一条生产记录（ADR-052）。

### 追溯

`GET /assets/{id}/lineage` 沿当前的关系遍历：

| 参数 | 取值 | 默认 |
|------|------|------|
| `direction` | `up` 上游、`down` 下游、`both` | `up` |
| `types` | 关系类型列表 | `source` |
| `depth` | 最大层数 | 5 |

返回一张图：
- 节点是资产摘要；
- 边带关系类型、位置名 `slot`（有的话）、是否断链、是否上游已更新；
- 来源边附带生产记录的摘要：方式、工具、提示词开头、执行者。

### Agent 摘要

`GET /assets/{id}/summary` 返回让 Agent “看到”资产的最小内容：

| 格式 | 文字部分 | 概览图 |
|------|----------|--------|
| 图片 | 尺寸、色彩模式、是否带透明 | 缩略图（动图也用静止的缩略图） |
| 视频 | 时长、分辨率、帧率、编码 | 关键帧条 |
| 音频 | 时长、声道、采样率 | 波形图 |
| 模型 | 面数、材质数、贴图列表、骨骼与动画片段 | 正、侧、背、顶四个正交视图的拼图 |
| 文档 | 标题与开头若干行；设计对象写了目标尺寸时一并给出 | 无 |

文字部分由格式插件在服务端生成，处理时缓存下来。概览图来自缓存：依次取摘要图（`turnaround`）、缩略图（`thumb`）。

- 图片与音频的概览图在服务端生成，入库后很快就有。
- 模型与视频的概览图要靠浏览器渲染，服务器不渲染：有人打开页面后，才由他的浏览器渲染并交回保存。在那之前，响应里没有概览图，并说明「概览图还没有渲染，有人打开页面后才会生成」；文字部分照常返回。
- Agent 批量登记模型后，在有人打开页面之前拿不到这些模型的概览图。
- 渲染过的概览图保存在资产库里，随资产库同步，不必重新渲染。

设计对象的目标尺寸是建模、生成四视图等任务的依据：Agent 通过 `bb_get` 或沿归属关系追溯读到它。生成四视图时把目标尺寸与格子排布写进提示词，登记时带上 `views`；交给建模 Agent 的任务带上同一个尺寸。

### MCP 工具

MCP 服务通过 `bb mcp` 启动，以标准输入输出通信，提供十个工具，没有资源与提示词。连接哪个服务看 `BOWERBIRD_URL` 或 `--server`；Agent 的名字看 `--name` 或 `BOWERBIRD_AGENT`，没有时记 `agent:unnamed`。

| 工具 | 对应接口 | 参数 | 作用 |
|------|----------|------|------|
| `bb_search` | `POST /search` | `query`（文本语法）、`filter`（覆盖解析出的同名字段）、`sort`、`limit`（默认 20，最多 200）、`cursor` | 返回精简结果 |
| `bb_get` | `GET /assets/{id}`、`/summary` | `id`（GUID 或路径）、`image` | 详情，可选带概览图 |
| `bb_trace` | `GET /assets/{id}/lineage` | `id`、`direction`、`types`、`depth`（1 到 50，默认 5） | 向上或向下追溯 |
| `bb_register` | `POST /records`、`POST /assets` | `files` 或 `path`、`folder`、`name`、`stage`、`tags`、`description`、`review`、`relations`、`record`、`views`、`onConflict` | 登记新资产，含关系、生产记录与四视图的格子信息 |
| `bb_update` | `PATCH /assets/{id}`、关系接口、`POST /relations/retarget` | `id`、`tags`（增、删、设为）、`description`、`stage`、`relations`（增、删、换）、`retarget`（不带 `apply` 时只预览） | 修改标签、描述、阶段；新增、更换、删除关系 |
| `bb_fetch` | `GET /assets/{id}/file`、`POST /export`、`POST /export/plan` | `id`、`withDeps`、`to`、`layout` | 取得文件路径或下载地址；给了 `to` 时导出到目录 |
| `bb_creators` | `GET /creators` | 无 | 列出可用的创建方式及其参数与输入 |
| `bb_create` | `POST /creators/{id}/runs`、`GET /jobs/{id}` | `creator`、`params`、`inputs`、`folder`；或 `job` 查询 | 发起一次创建，查询任务的进度与产出 |
| `bb_vocabulary` | `GET /vocabulary` | 无 | 列出可用的标签、阶段、格式、关系类型 |
| `bb_health` | `GET /issues` | `type`、`level`、`id` | 列出完整性问题 |

**工具设计约定**

- 每个工具的返回都以紧凑文本为主，字段固定，不返回可重算的冗长信息。
- `bb_search` 的每条结果都带阶段、校验状态与问题标记。
- `bb_get`：
  - 返回概览图时用 MCP 的图片内容类型，具备视觉能力的 Agent 可以直接查看；
  - 概览图还没有渲染时只返回文字部分，并用一句话说明原因。
- 按 GUID 或路径取单个资产时，不受 Agent 搜索范围的限制。
- `bb_update` 可以把指向一个资产的关系全部换成指向另一个资产（`POST /relations/retarget`），先预览后执行。这个批量更换只给 Agent 用。
- `bb_fetch`：
  - Agent 与服务位于同一台机器时，返回文件的本地路径，否则返回下载地址；
  - 导出时，同一台机器上由服务直接写到目录；不在同一台机器上时，先取导出计划，再逐个下载写到 Agent 所在机器的目录（ADR-050）；
  - 连同依赖导出模型时，贴图等按 `slot` 的名字写出，模型离开 Bowerbird 后仍能按文件里写的名字找到它们。
- `bb_register` 与 `bb_update` 由多步组成，中途失败时回报三段：失败前已完成的步骤、失败的那一步与错误、还有几步没执行。其他工具失败时返回 `error <错误码>: <说明>`。
- MCP 服务不提供删除工具。删除需要通过界面或命令行完成。

### 命令行

命令行工具名为 `bb`（也可以叫 `bowerbird`）。
- 全局选项：`--json`、`--server <地址>`、`--library <标识>`、`--version`，写在子命令前后都可以。
- 成功退出码为 0，出错为 1；`--json` 下的错误输出 `{ "error": { code, message, details? } }`。

| 命令 | 作用 |
|------|------|
| `bb init <目录> [--name]` | 把一个文件夹初始化为资产库；目录不存在时创建 |
| `bb serve [目录] [--host] [--port] [--name]` | 启动服务；给出的目录登记为资产库，并作为这次打开的库；目录不存在时创建 |
| `bb search [查询…] [--limit] [--sort] [--cursor]` | 搜索，支持文本语法 |
| `bb get <GUID 或路径>` | 详情与摘要 |
| `bb trace <GUID 或路径> [--direction] [--types] [--depth]` | 追溯 |
| `bb add <文件…>` | 登记资产，可带 `--folder`、`--stage`、`--tag`、`--description`、`--source`、`--prompt`、`--method`、`--tool`、`--on-conflict`；已在资产库里的文件就地登记 |
| `bb tag <GUID 或路径…> --add/--remove` | 增删标签 |
| `bb export <GUID 或路径…> --to <目录> [--with-deps] [--flat]` | 导出 |
| `bb health [--type] [--level]` | 列出完整性问题 |
| `bb rescan [目录]` | 触发扫描 |
| `bb rm <GUID 或路径…> [--force]` | 移入回收站 |
| `bb plugin list / add <包名或路径> / update [标识] / remove <标识>` | 插件管理 |
| `bb mcp [--name]` | 启动 MCP 服务 |

- 除 `init`、`serve`、`plugin`、`mcp` 外，其余命令都通过 HTTP API 与正在运行的服务通信。
- `--host`、`--port` 只作用于这次运行，不写入本机配置；`/config` 读写的始终是保存的配置，所以以 `--host` 启动后在网页上改监听地址，保存的是新值，并提示重启后生效。
- `bb serve` 只托管构建好的外壳，找不到时只提供接口（ADR-050）。

**部分失败**
- `bb add` 按顺序登记，遇到第一个失败就停，已登记的保留在资产库里，退出码 1。`--json` 输出为：

  ```jsonc
  {
    "registered": [{ "file": "a.png", "result": { "asset": { … }, "skipped": false, "recordId": "…", "newTags": [] } }],
    "failed": { "file": "b.png", "error": { "code": "conflict", "message": "…" }, "notRun": ["c.png"] },
    "recordId": "…"   // 多个文件共用一条新建的生产记录时
  }
  ```

  全部成功时 `failed` 为 `null`。
- `bb rm` 逐个处理并收集失败：`{ trashed: [...], failed: [{ ref, code, message }] }`，有失败时退出码 1。

**远程导出**：`bb export` 与服务在同一台电脑上时，由服务直接写到目录；否则先取导出计划，再逐个下载写到本机目录。

**环境变量**

| 变量 | 作用 | 默认 |
|------|------|------|
| `BOWERBIRD_URL` | 命令行与 `bb mcp` 连接的服务；`--server` 优先 | `http://127.0.0.1:7420` |
| `BOWERBIRD_ACTOR` | 命令行写操作的执行者，必须带 `user:` 或 `agent:` 前缀 | 不带，记 `user:unnamed` |
| `BOWERBIRD_AGENT` | `bb mcp` 的 Agent 名字，不带前缀；`--name` 优先 | 记 `agent:unnamed` |
| `BOWERBIRD_HOME` | 本机数据目录 | `~/.bowerbird` |
| `BOWERBIRD_LOG_LEVEL` | 日志最低级别 | `info` |

### 标签治理

为避免同义标签泛滥：

- 登记或修改资产时，响应里列出本次新出现的标签，并为每个新标签给出相近的已有标签。
- `bb_vocabulary` 让 Agent 在打标签前先了解现有词表与各标签的用量。
- 界面的标签管理提供改名与合并，合并会更新所有相关资产的元数据文件。

### 安全

内核不做登录与权限。细则见 ADR-049。

- **默认只监听本机**：服务默认绑定 `127.0.0.1`，端口 `7420`。
- **局域网访问需要显式打开**：启动时指定 `--host 0.0.0.0`，或在本机配置里改监听地址，才会接受其他电脑的连接。
- **没有访问控制插件时不做访问限制**：其他电脑上能用的功能与本机相同，包括修改设置与安装插件；只有下面的本机动作限本机。
- **风险**：局域网里任何能访问该端口的人都能读写资产库，也能在那台电脑上安装插件、运行程序。打开局域网访问时，启动输出与界面都给出这条提醒。
- **登录由插件提供**：
  - 账号、密码、邮箱验证都放在访问控制插件里，内核不做；
  - 内核在 `/api/v1/` 下除健康检查外的每个请求进入时询问访问控制插件，插件可以拒绝（`forbidden`），识别出的名字作为执行者；
  - 带 `{library}` 的接口只问这个库的插件，全局接口问所有可用库的插件，任一拒绝即拒绝；
  - 第一期没有带这样的插件。
- **不得直接暴露到公网**：确有需要的使用者应在前面放置带鉴权的反向代理。这一点写入使用文档。
  - 只监听本机时，反向代理要把主机头改回本机地址，或把对外地址加进 `allowedOrigins`；
  - 经反向代理转发的请求不算本机。
- **校验主机头**，防止 DNS 重绑定：
  - 接受 `localhost`、回环地址与允许列表里的主机名；
  - 监听非回环地址时，另外接受 IP 字面量与本机的名字；
  - 其余返回 `forbidden`。
- **校验来源头**：
  - 同源与不带来源头的请求放行；
  - 本机配置 `allowedOrigins` 里的来源可以跨域访问（不带凭据）；
  - 其余拒绝，防止恶意网页借用户浏览器访问本机服务。
- **外壳页面的内容安全策略**：脚本、插件网页模块、图片、媒体、请求、框架只能来自本服务、`data:` 与 `blob:`。插件查看器因此无法让浏览器去请求资产文件里写着的外部地址。
- **HTML 资产隔离**（ADR-043）：
  - 网页原型类资产在 `sandbox="allow-scripts"`（不带同源权限）的框架里运行，来源是不透明的，调不到 Bowerbird 的接口；
  - 只有包内文件端点对这类框架加载自己的子资源放行；
  - 资产文件中会执行的类型另带 `Content-Security-Policy: sandbox allow-scripts`，所有文件响应带 `X-Content-Type-Options: nosniff`。
- **本机动作只在本机出现**：用默认程序打开源文件、在文件夹中显示（资产与资产库）、导出到目录，都在服务所在的那台电脑上执行。
  - 本机请求指对端是回环地址、且没有经过反向代理转发（不带 `X-Forwarded-For`、`Forwarded`、`X-Real-IP`）；
  - 从其他电脑打开页面时，界面把打开与显示换成「下载源文件」，导出只能下载压缩包；其他电脑发来的这些请求返回 `not_local`；
  - 这是为了好用，不是访问限制。
- **删除可恢复**：所有删除都先进回收站。

执行者字段只用于留痕，不构成任何访问控制。

## 待解决

- 是否需要一个只读模式的启动参数，供只想让同事浏览而不允许修改的场景使用，待定。现在只有由更新版本写过的资产库会以只读打开。
- 导出到游戏引擎工程时的目录映射规则，留给后续的引擎对接插件。

## 相关

- 查询模型：[`search.md`](search.md)。
- 关系与生产记录的语义：[`data-model.md`](data-model.md)。
- 复制与删除的行为：[`sync-and-integrity.md`](sync-and-integrity.md)。
- 创建方式、动作、访问控制与插件自己的接口：[`plugin-system.md`](plugin-system.md)。
- 决策：ADR-009、ADR-011、ADR-016、ADR-018、ADR-019、ADR-020、ADR-023、ADR-024、ADR-025、ADR-026、ADR-027、ADR-029、ADR-036、ADR-038、ADR-042、ADR-043、ADR-047、ADR-048、ADR-049、ADR-050、ADR-052。
