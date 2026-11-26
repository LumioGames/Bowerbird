---
name: library-format
description: 资产库磁盘格式——目录布局、.bmeta 元数据文件结构、文件夹设置、包式资产、.bowerbird 库级数据、本机数据目录与忽略规则；读写磁盘格式时查
metadata:
  type: doc
  status: 已交付
---

# 资产库格式

一个资产库就是一个根文件夹：正常的目录树、原始文件名，每个资产旁边放一份同名的元数据文件。这份格式是公开的，人和 Agent 不经过 Bowerbird 也能读懂。

## 背景 / 目标

- 资产库要能放在任何本地可见的位置：本地盘、NAS 挂载、云盘同步目录、Docker 卷。
- 目录结构要对人和 Agent 都有意义，离开 Bowerbird 仍然可用。
- 多台机器同步同一个文件夹时，冲突范围要尽量小。
- 可重建的数据不能污染真值。

## 设计

### 目录布局

```text
MyLibrary/
├── .bowerbird/                       库级数据
│   ├── library.json                  库标识、格式版本、启用的插件、库设置
│   ├── tags.json                     标签定义
│   ├── views/                        智能文件夹（保存的查询）
│   ├── records/                      生产记录
│   ├── thumbs/                       手动指定的缩略图
│   ├── trash/                        回收站
│   └── cache/                        缩略图、预览文件与摘要文字，可重新生成，随资产库同步
├── .bbignore                         忽略规则，可选
├── props/
│   ├── _folder.bmeta                 文件夹设置，可选
│   └── chest/
│       ├── chest.md                  设计对象“宝箱”的说明文档
│       ├── chest.md.bmeta
│       ├── chest_concept.png
│       ├── chest_concept.png.bmeta
│       ├── chest.glb
│       └── chest.glb.bmeta
└── ui/
    ├── shop_prototype/               包式资产：一个网页原型
    │   ├── index.html
    │   └── assets/…
    └── shop_prototype.bmeta
```

**规则**

- 资产库里的文件夹就是用户看到的文件夹，没有另一套虚拟层级。一个资产只在一个文件夹里；跨文件夹的归类用标签和智能文件夹。
- 元数据文件名是“资产文件名加 `.bmeta`”，与资产放在同一目录。不使用 `.meta` 后缀，避免与 Unity 的同名文件冲突。
- 资产库根目录由 `.bowerbird/library.json` 的存在来识别。

### 元数据文件

每个资产一份，UTF-8 编码的 JSON，键按固定顺序输出、两空格缩进，便于比对和纳入版本控制。

```jsonc
{
  "bb": 1,                                        // 元数据格式版本
  "id": "0192f3a7-5c1e-7b3a-9d2f-4a6c8e0b1d23",   // GUID
  "hash": "sha256:9c1e…",                         // 当前内容指纹
  "stage": "runtime",                             // reference / production / runtime
  "tags": ["宝箱", "道具"],
  "description": "一级宝箱，木质，金属包边",
  "fields": {                                     // 自定义字段，按插件标识分命名空间
    "studio.prop-template": { "rarity": "common" }
  },
  "auto": {                                       // AI 产出，与人工信息分开
    "tags": ["木质", "金属包边"],
    "description": "一个带金属包边的卡通木箱",
    "by": "bowerbird.enrich-vision@1.2.0",
    "hash": "sha256:9c1e…"                        // 产出时对应的内容指纹
  },
  "relations": [
    { "type": "source",  "to": "<四视图 GUID>", "toHash": "sha256:…", "record": "rec_0192…" },
    { "type": "uses",    "to": "<贴图 GUID>", "slot": "chest_basecolor.png" },   // slot：模型文件里写的位置名
    { "type": "belongs", "to": "<chest.md GUID>" }
  ],
  "review": {                                     // 只保存最近一次的校验结论
    "status": "approved",                         // pending / approved / rejected / exempt
    "hash": "sha256:9c1e…",                       // 校验时的内容指纹
    "by": "user:cui",
    "at": "2026-11-25T08:30:00Z",
    "note": ""
  },
  "versions": [
    { "hash": "sha256:41ab…", "size": 1834201, "at": "2026-11-20T03:12:00Z", "by": "agent:modeler", "note": "初版" },
    { "hash": "sha256:9c1e…", "size": 1902877, "at": "2026-11-24T10:05:00Z", "by": "user:cui", "note": "修正包边比例" }
  ],                                              // 恢复旧版本产生的一条另有 "restoredFrom": N
  "auxiliary": false,                             // 是否为附属文件
  "bundle": false,                                // 是否为包式资产
  "thumbnail": null,                              // 手动缩略图的文件名，位于 .bowerbird/thumbs/
  "origin": "rec_0192…",                          // 产出它的生产记录（ADR-027），没有时省略
  "created":  { "at": "2026-11-20T03:12:00Z", "by": "agent:modeler" },
  "modified": { "at": "2026-11-25T08:30:00Z", "by": "user:cui" }
}
```

**字段约定**

- 必填：`bb`、`id`、`hash`、`stage`、`created`。其余缺省时按空值处理。
- 顶层字段按这个顺序写出：`bb`、`id`、`hash`、`stage`、`tags`、`description`、`fields`、`auto`、`relations`、`review`、`versions`、`auxiliary`、`bundle`、`thumbnail`、`views`、`origin`、`created`、`modified`，不认识的字段跟在后面。
- `bb` 不是 1 的元数据文件按解析不了处理，登记「元数据冲突」。
- `fields` 里以 `bowerbird.` 开头的命名空间留给内核（ADR-051）：
  - `bowerbird.identity`：重复身份待确认，`{ copiedFrom, at, confirmed, reason, originalPath, copyPath }`；
  - `bowerbird.bundle`：包式资产的入口，`{ entry }`。
- 时间一律为 UTC 的 ISO 8601 字符串。
- 不认识的顶层字段原样保留，不丢弃。这样旧版本的 Bowerbird 不会破坏新版本写入的数据。
- 写入采用“先写临时文件再改名”，保证不会出现写了一半的文件。

**位置名**：资产文件里写着的引用名（例如模型文件里的贴图文件名）只表示“这里有一个位置”。
- 位置对应哪个资产，由带 `slot` 的关系记在元数据文件里，并以它为准。Bowerbird 不往资产文件里写任何东西。
- 位置名只能是资产库内的相对路径：不以 `/` 或盘符开头，不含 `..` 段，分隔符为 `/`（ADR-048）。

**四视图的格子信息**：四视图图片的元数据文件另有顶层字段 `views`，记下图按几行几列排布、每一格是哪个视图：

```jsonc
{
  "views": {
    "rows": 2,
    "cols": 2,
    "cells": ["front", "side", "back", "top"]     // 从左到右、从上到下；取值 front / side / back / top
  }
}
```

格子信息由生成四视图的一方在登记时写入，从图片里算不出来，所以它是真值。

字段的含义见 [`data-model.md`](data-model.md)。

### 文件夹设置

文件夹可以放一份 `_folder.bmeta`，保存这个文件夹在界面上的显示设置，并为其中新入库的资产提供默认值：

```jsonc
{
  "bb": 1,
  "label": "道具",                // 显示名
  "icon": "box",                  // 图标名
  "description": "道具类运行时资产", // 备注
  "defaults": {
    "stage": "runtime",
    "review": "pending",        // 设为 exempt 表示该文件夹免审
    "tags": ["道具"]
  }
}
```

- `label` 是界面上显示的名称，不改变磁盘上的目录名；缺省时显示目录名。
- `icon` 是界面上显示的图标，取自外壳提供的图标集；缺省时显示普通文件夹图标。
- `description` 是备注，显示在检查器的文件夹信息里。
- 这三项只作用于该文件夹本身，不向下继承；在检查器的文件夹形态里编辑。
- 默认值逐项向上继承：某一项在当前文件夹没有设置，就取最近的上级文件夹的设置。
- 默认值只在资产被认领时生效一次，之后改文件夹设置不会回头修改已有资产。

### 包式资产

一个文件夹作为一个资产时：

- 元数据文件放在该文件夹的**旁边**，名为“文件夹名加 `.bmeta`”，其中 `bundle` 为 `true`。
- 扫描器遇到带这种元数据文件的文件夹时，把它当成一个整体，不再进入内部逐个认领。
- 内容指纹是目录指纹：包内每个文件写成「相对路径 空格 文件指纹」一行，排序后连起来再算指纹。内置忽略规则在包内照样生效，`.bbignore` 不进包内。
- 包式资产只能通过界面或接口显式创建，扫描器不会自动把普通文件夹判定为包。创建时（ADR-041、ADR-051）：
  - 里面各资产的元数据文件与包文件夹自己的 `_folder.bmeta` 移入回收站；
  - 包的标签取里面资产人工标签的并集；
  - 里面资产指向外面的关系移到包上，外面指向里面的关系改指向包、`slot` 记包内相对路径；
  - 包里不能再套包。
- 入口文件：创建时给了就记在 `fields['bowerbird.bundle'].entry`；没给时依次取 `index.html`、顶层的 HTML 文件、任一 HTML 文件、第一个文件。

### 附属文件

单独没有意义、只被其他资产引用的文件（例如 glTF 的 `.bin`）仍然是资产，有自己的 GUID，由格式插件在提取信息时把 `auxiliary` 置为 `true`。引用它的资产以带 `slot` 的引用关系指向它。附属文件在网格里默认隐藏，可以切换显示。

### 库级数据 `.bowerbird/`

| 路径 | 内容 | 是否真值 |
|------|------|----------|
| `library.json` | 库的 GUID、名称、格式版本、需要的插件及版本范围、库设置 | 是 |
| `tags.json` | 标签定义：分组、颜色、别名 | 是 |
| `views/<名称>.json` | 智能文件夹，即保存的查询条件 | 是 |
| `records/<年份>/<记录标识>.json` | 生产记录，一条一个文件 | 是 |
| `thumbs/<GUID>.webp` | 手动指定的缩略图 | 是 |
| `trash/<回收标识>/` | 被删除的资产文件、其元数据文件、说明 `info.json` | 是 |
| `cache/` | 缩略图、预览文件、Agent 摘要文字 | 否，可删除重建；随资产库同步 |

**回收说明 `info.json`**：

```jsonc
{
  "bb": 1,
  "id": "<回收标识>",
  "assetId": "<GUID>",
  "name": "chest.glb",
  "originalPath": "props/chest/chest.glb",
  "deletedAt": "2026-11-25T08:30:00Z",
  "deletedBy": "user:cui",
  "bundle": false,
  "batch": "<批次>",        // 一次删除文件夹移入的项共用一个批次
  "recordOnly": false,      // true：只有元数据文件（缺失资产、被替下的元数据文件）
  "kind": "sidecar"         // 单独的元数据文件为 sidecar，文件夹设置为 folder-meta；资产省略
}
```

**生产记录文件**：UTF-8 编码的 JSON，一条记录一个文件，字段与 [`data-model.md`](data-model.md) 的“生产记录”一节相同：`bb`、`id`、`method`、`tool`、`plugin`、`prompt`、`params`、`inputs`、`by`、`at`、`note`、`notes`。

- `method` 是开放值，插件自定义的值以插件标识作前缀。
- `plugin` 是插件标识加版本，由内核填写；库外登记的记录没有它。
- `params` 约定三个常用键 `model`、`seed`、`negativePrompt`，其余键自由。
- `inputs` 的每一项可以带 `role`，说明这个输入的角色。
- 文件里不列产出。一条记录产出了哪些资产，由 `origin` 等于它的资产，加上来源关系的 `record` 指向它的资产反查（ADR-027）。
- 通过 `POST /records` 建的记录立即写出。创建与动作任务的记录在登记第一个产出时写出，没有任何产出的运行不写记录文件。
- 文件写入后不再修改，只能在 `notes` 里追加备注。

`library.json` 示例：

```jsonc
{
  "bb": 1,
  "id": "0192f000-…",
  "name": "MyLibrary",
  "created": "2026-11-25T00:00:00Z",
  "plugins": {
    "bowerbird.image": "^0.1.0",
    "bowerbird.model": "^0.1.0",
    "community.spine": "^1.4.0"
  },
  "pluginFormats": {                // 非内置插件认领的后缀（ADR-044）
    ".skel": "community.spine"
  },
  "settings": {
    "defaultStage": "production",
    "agentSearchScope": "all",      // all：返回全部并标明状态；approved：默认只返回已通过
    "trashDays": 7,                 // 回收站保留天数，1 到 3650
    "plugins": {                    // 插件随资产库走的设置
      "bowerbird.model": { "defaultEnvironment": "studio" }
    },
    "ignoredIssues": []             // 被忽略的问题标识
  }
}
```

- 新建资产库时，`plugins` 写入全部内置插件，版本范围为 `^<当前版本>`。
- 启用一个非内置插件时，内核把它清单里声明的后缀写进 `pluginFormats`；停用不删。

**资产库不携带可执行代码**。`plugins` 只声明这个库需要哪些插件，插件本身安装在本机；插件放在资产库里时拒绝安装、不加载（ADR-012、ADR-052）。打开一个缺少插件的库时，对应格式按未知格式显示，按 `pluginFormats` 在资产上标出缺少哪个插件（ADR-044）。

### 本机数据目录

可重建且不适合同步的数据，以及临时文件，放在本机，默认位置 `~/.bowerbird/`，可用环境变量 `BOWERBIRD_HOME` 修改：

| 路径 | 内容 |
|------|------|
| `config.json` | 服务设置：监听地址与端口；`libraries`，已登记的资产库，每项含标识与根文件夹；各库的缓存目录覆盖（`cacheDirs`）；扫描间隔（`scanIntervalMinutes`）；并发数；允许的来源（`allowedOrigins`）；各插件只在本机的设置（`scope` 为 `machine` 的设置项，访问凭据属于这一类）；按路径安装的插件（`installed`） |
| `plugins/` | 本机按包名安装的第三方插件 |
| `libraries/<库 GUID>/index.sqlite` | 索引数据库与任务队列，每个资产库一份 |
| `libraries/<库 GUID>/plugins/<插件标识>/` | 插件数据目录，例如关键词搜索的全文索引（ADR-028） |
| `tmp/<插件标识>/` | 插件临时目录，例如创建插件没挑中的候选产出；不进资产库，可随时清理 |
| `logs/` | 运行日志 |

**多个资产库**：一个 Bowerbird 可以登记多个资产库，在界面上切换。已登记的资产库列在 `config.json` 的 `libraries` 里，索引按库分开存放。

索引数据库不放进资产库，因为数据库文件位于 NAS 或云盘同步目录时容易损坏或产生冲突副本。索引丢失后可以从资产库完整重建。

缩略图、预览文件与 Agent 摘要保存在资产库内的 `.bowerbird/cache/`，随资产库一起同步与做版本管理：一个人生成过，其他人同步下来就有，不必重新生成。缓存文件以缓存键命名，写入后不再修改，所以同步时只会新增、不会冲突。缓存目录可以在本机配置里改到别处，改了之后这台机器的缓存不再随资产库同步。

### 忽略规则

以下内容不会被认领为资产：

- 内置忽略：`.bowerbird/`、`*.bmeta`、`_folder.bmeta`、`.bbignore`、以点开头的文件和目录、`Thumbs.db`、`desktop.ini`、`~$*`、`*.tmp`、`*.part`、`*.crdownload`。
- 资产库根目录的 `.bbignore`，语法与 `.gitignore` 相同。

### 格式版本与迁移

- `bb` 字段是格式版本号，当前为 `1`。
- 只增加可选字段不升版本号。改变已有字段含义才升版本号，并随版本提供一次性迁移命令。
- `library.json` 的版本号高于自己支持的版本时，Bowerbird 以只读方式打开该资产库并提示升级；写操作返回 `read_only`。

### 云盘冲突副本的命名

两台机器同时改了同一份元数据文件时，云盘留下的冲突副本按下面的命名识别（ADR-051）：

| 云盘 | `chest.glb.bmeta` 的冲突副本 |
|------|------|
| Dropbox | `chest.glb (某人's conflicted copy 2026-11-25).bmeta`，也认 `conflict`、`冲突` 的本地化写法 |
| Google Drive | `chest.glb (1).bmeta` |
| iCloud | `chest.glb 2.bmeta` |
| OneDrive | `chest.glb-<机器名>.bmeta` |

读得出的副本不看名字，按里面的 GUID 找到正本；读不出的才按命名找。

## 待解决

（暂无）

## 相关

- 字段语义：[`data-model.md`](data-model.md)。
- 外部改动如何被收进来：[`sync-and-integrity.md`](sync-and-integrity.md)。
- 缓存的生成与失效：[`pipeline-and-cache.md`](pipeline-and-cache.md)。
- 决策：ADR-008、ADR-012、ADR-016、ADR-017、ADR-018、ADR-019、ADR-022、ADR-025、ADR-026、ADR-027、ADR-028、ADR-041、ADR-044、ADR-048、ADR-051、ADR-052。
- 已有答案的原待解决项：云盘冲突副本的命名见上文与 ADR-051。
