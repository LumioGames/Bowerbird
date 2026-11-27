# Bowerbird 使用说明

Bowerbird 是一个网页版的游戏资产管理器，源码公开：把图片、视频、音频、3D 模型、文档等资产放进一个磁盘文件夹统一管理，人用浏览器浏览、预览、校验、追溯，Agent 用命令行或 MCP 检索、登记、取用。

本文说明怎么安装、启动、在局域网里共用、用命令行与 MCP，以及用 Docker 部署。

## 安装

需要 Node.js 22.12 或更新版本。

```bash
# 全局安装，之后可以直接用 bb 命令（bb 与 bowerbird 是同一个命令）
npm install -g bowerbird
bb serve ~/Art/星落

# 或者不安装，直接运行（第一次要下载依赖，稍等）
npx bowerbird serve ~/Art/星落
```

`bowerbird` 包里带着网页外壳和六个内置插件（图片、视频、音频、3D 模型、文档、关键词搜索），内核、服务、命令行与 MCP 服务作为它的依赖（`@bowerbird/*`）一起装上。安装只包含运行要用的东西：网页外壳与插件的网页部分都已构建好，不带构建工具，也不装 React。写插件才需要构建工具 `@bowerbird/plugin-build`，见 [插件开发](plugin-development.md)。

### 发布到 npm 之前：用本地打包的安装

还没发布时，从源码打出安装包，装进一个普通文件夹（不要用 `-g`：全局安装会去 npm 上找还没发布的 `@bowerbird/*` 依赖）：

```bash
# 在源码目录
pnpm install
pnpm build
mkdir -p .tmp/pack
for p in bowerbird @bowerbird/schema @bowerbird/plugin-sdk @bowerbird/core @bowerbird/server @bowerbird/mcp @bowerbird/cli; do
  pnpm --filter "$p" pack --pack-destination .tmp/pack
done

# 装到任意文件夹
mkdir -p ~/bowerbird-local && cd ~/bowerbird-local
npm init -y
npm install <源码目录>/.tmp/pack/*.tgz
npx bb serve ~/Art/星落
```

打 `bowerbird` 包时会自动把构建好的六个内置插件与网页外壳复制进去，所以先要 `pnpm build`。

### 从源码直接运行

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js serve ~/Art/星落
```

## 启动

```bash
bb serve ~/Art/星落
```

- 给出的文件夹会登记为资产库，并作为这次打开的库。文件夹不存在时会新建一个空文件夹。
- 启动后在浏览器打开命令打印的地址，默认是 `http://127.0.0.1:7420`。
- 文件夹里已经有文件、但还不是资产库时，网页上会先说明首次打开会做什么（只读取文件，不改动它们，也不在旁边写东西；哪些格式还没有插件能读），确认后才开始读取；读取可以停止，下次接着做。
- 给一个文件记下标签、描述、关系、出处等信息之后，它旁边才会多一个同名的 `.bmeta` 元数据文件。没人动过的文件旁边什么都不写。
- 第一次在一个浏览器里打开有资产的库时，浏览页会走一个五步的导览；其他页面第一次打开时，一个小手指指着那页最主要的按钮说一句话；网格里第一次出现某类文件时，也会指着它说这种文件能做什么。左栏左下角的「?」里可以重新看导览，或者关掉这些提示。
- 只想把文件夹初始化为资产库、不启动服务时用 `bb init <目录>`。它只写 `.bowerbird/` 文件夹。
- 服务是用来看和加速的。不开服务，命令也能读写资产库，见下文「命令行」。
- 不带目录的 `bb serve` 打开之前登记过的资产库。

**启动参数与环境变量**（优先级高于本机配置）：

| 参数 / 变量 | 作用 | 默认 |
|-------------|------|------|
| `--host <地址>` | 监听地址 | `127.0.0.1` |
| `--port <端口>` | 端口 | `7420` |
| `BOWERBIRD_HOME` | 本机数据目录：本机配置、索引、日志、安装的插件、临时文件 | `~/.bowerbird` |

**数据放在哪**：

- 资产库文件夹是唯一真值：资产文件、记过信息的文件旁边的 `.bmeta`（标签、关系、出处等都在里面）、`.bowerbird/` 下的库级数据（库设置、标签定义、智能文件夹、缩略图缓存）。整个文件夹可以用任何同步工具同步。
- 之前版本的资产库里有 `.bowerbird/records/`（生产记录）。第一次打开时，记录的内容自动写进各个产出的 `.bmeta`，这个文件夹改名为 `records-converted-<日期>` 留着，不删。
- 本机数据目录（`BOWERBIRD_HOME`）里的索引都能从资产库重建，删掉后重新启动会重建。

## 多个资产库

一个资产库就是一个根文件夹，一个 Bowerbird 可以登记多个：

- 每次 `bb serve <目录>` 都会把目录登记进本机配置；也可以在网页的资产库菜单里「添加资产库…」。
- 在网页上切换资产库只影响自己的浏览器，不影响别人正在看的页面。
- 接口地址里带着库的标识：`/api/v1/libraries/{库标识}/…`。命令行用 `--library <库标识或名称>` 指定；不指定时用工作目录所在的资产库，不在资产库文件夹里时用默认库。
- 各库的索引分开存放在本机数据目录。

## 局域网与安全

Bowerbird 没有登录功能。请先读完这一节再打开局域网访问。

- **默认只有这台电脑能访问**：服务只监听 `127.0.0.1`。
- **打开局域网访问**：`bb serve <目录> --host 0.0.0.0`，或在网页设置里改监听地址后重启。启动时会打印警告。
- **打开之后，局域网里任何能访问这个地址的人，都能读写整个资产库，也能在这台电脑上安装插件，也就是运行任何程序。** 其他电脑上能用的功能与本机相同，包括修改设置。只在可信的局域网里这样做。
- **不得直接暴露到公网。** 确实需要从外网访问时，在前面放一个带鉴权的反向代理（例如带登录的 Nginx、Caddy、Traefik，或公司的单点登录网关），只让通过鉴权的人到达 Bowerbird。
- **执行者只是留痕**：写操作记下执行者（`user:<名字>` 或 `agent:<名字>`），在网页设置里填自己的名字；没填时记为「未署名」。它不是身份认证，谁都可以填任何名字。
- **请求来源校验**：服务检查请求的主机头与来源头，拒绝陌生网页借你的浏览器访问本机服务（包括 DNS 重绑定）。默认不提供跨域访问。打开局域网访问后，用 IP 地址或这台电脑的主机名访问都可以；其他名字（例如内网域名）要加进 `allowedOrigins`。
  - 用反向代理时，把对外的地址加进本机配置的 `allowedOrigins`（例如 `"allowedOrigins": ["https://assets.example.com"]`，位于 `~/.bowerbird/config.json`），否则代理转发来的请求会被拒绝。
- **网页原型类资产**在不带同源权限的沙箱框架里运行，读不到 Bowerbird 的接口。
- **只在本机执行的动作**：「用默认程序打开」「在文件夹中显示」以及导出到服务器上的目录，是在运行 Bowerbird 的那台电脑上执行的，只接受那台电脑发来的请求；从其他电脑打开页面时换成「下载源文件」与下载压缩包。经过反向代理转发的请求一律按其他电脑处理。
- **删除可以恢复**：所有删除都先进回收站，默认保留 7 天。
- **只安装来源可信的插件**：插件运行在服务进程里，与服务拥有相同的文件与网络权限，没有沙箱。
- **访问密钥只写不读**：插件里标为只写的设置（例如 AI 服务的访问密钥）保存在本机配置里，接口与网页只告诉你「已设置」（值显示为 `{ "set": true }`），不会把密钥本身发回浏览器或客户端。保存其他设置时原样带回这个占位，密钥保持不变；要清除就把它设为 `null`。

### 没有版本插件时，覆盖文件后旧内容找不回

「替换内容」、上传时选「替换为新版本」、或在资产库文件夹里直接覆盖文件，都会改写资产文件本身。内核只记下版本记录（内容指纹、时间、执行者、说明），**不保存旧文件的内容**。没有安装版本插件时，覆盖之后旧内容就找不回了。需要保留历史内容的团队请：

- 用自己的同步或备份工具（NAS 快照、云盘历史版本、Git LFS 等）保护资产库文件夹；或
- 等版本插件（第一期之后提供）。

## 命令行

所有子命令都支持 `--json`，输出接口原样的 JSON，便于脚本与 Agent 解析；出错时退出码为 1，`--json` 下错误也以 JSON 输出到标准输出。

**不需要先开服务。** 命令按顺序找要用的服务：

1. `--server` 或 `BOWERBIRD_URL` 给出的服务；
2. 这台电脑上 `bb serve` 正在运行的服务；
3. `127.0.0.1:7420` 上能应答的服务。

后两种只在它打开了这条命令要用的资产库时才用。都没有时，命令自己打开资产库，读写完就退出：

- 开头先对一遍账，看看服务没开的这段时间文件夹里有什么变化。大资产库上会多等一会儿，这种库建议开着服务用。
- 缩略图、格式识别这类加工不在命令里做，留到下次服务启动。
- 同一个资产库同一时刻只有一个进程在写。另一个进程正在写时，命令报 `conflict`。

| 选项 / 变量 | 作用 | 默认 |
|-------------|------|------|
| `--server <地址>` / `BOWERBIRD_URL` | 用这个服务，例如另一台电脑上的 | 不设：按上面的顺序找，找不到就自己打开资产库 |
| `--library <标识或名称>` | 资产库 | 工作目录所在的资产库文件夹（没登记过就登记）；否则这台电脑的默认资产库 |
| `BOWERBIRD_ACTOR` | 写操作记下的执行者，例如 `user:lin` 或 `agent:modeler`；只写名字时当作 `user:<名字>` | `user:unnamed`（未署名） |

命令行的命令与 MCP 的工具出自同一份定义，参数与输出的文字相同。

| 命令 | 作用 |
|------|------|
| `bb init <目录> [--name 名称]` | 把一个文件夹初始化为资产库；只写 `.bowerbird/` |
| `bb serve [目录] [--host] [--port]` | 启动服务 |
| `bb search <查询>` | 搜索，支持文本语法 |
| `bb get <GUID 或路径>` | 详情：技术信息、出处、关系、问题、摘要 |
| `bb trace <GUID 或路径> [--direction up\|down\|both] [--types source,reference] [--depth 5]` | 追溯，默认走来源与参考 |
| `bb add <文件…> [--folder] [--stage] [--tag] [--description] [--source] [--reference] [--role] [--method] [--tool] [--prompt] [--param 名=值] [--note] [--batch] [--on-conflict]` | 登记资产，可同时说出来源、参考与出处 |
| `bb apply <清单> [--dry-run]` | 按清单写入每个资产应有的信息，只写有差别的部分 |
| `bb tag <GUID 或路径…> [--add 标签] [--remove 标签]` | 增删标签 |
| `bb retarget --from <资产> --to <资产> [--types] [--apply]` | 把指向一个资产的关系全部换成指向另一个；不带 `--apply` 只预览 |
| `bb export <GUID 或路径…> [--to <目录>] [--with-deps] [--flat]` | 文件在哪，或导出到目录 |
| `bb health [--type] [--level] [--ref]` | 列出完整性问题 |
| `bb resolve [问题标识…] [--type] --action <处理方式>` | 处理问题，例如 `--type stale-upstream --action acknowledge` 把「上游已更新」全部标为已复核 |
| `bb changes [--by 执行者] [--since 时间] [--folder]` | 某个执行者最后改过的资产，以及要提交的文件 |
| `bb rescan [文件夹]` | 触发扫描 |
| `bb rm <GUID 或路径…> [--force]` | 移入回收站；被引用时需要 `--force` |
| `bb untrack <GUID 或路径…>` | 移出资产库、不动文件：`.bmeta` 移入回收站，文件留着 |
| `bb create [创建方式] [--param] [--input 角色=资产] [--folder] [--job]` | 用创建插件生成资产；不给创建方式时列出可用的 |
| `bb action [动作] --on <资产…> [--param]` | 插件对选中资产的动作；不给动作时列出能用的 |
| `bb vocabulary` | 阶段、校验状态、格式、关系类型、标签用量、生产方式 |
| `bb plugin add <包名或路径>` / `list` / `update [标识]` / `remove <标识>` | 插件管理 |
| `bb mcp [--name 名称]` | 启动 MCP 服务 |

说明：

- **资产的写法**：GUID；资产库内的相对路径（`props/chest.glb`）；或以 `./`、`../`、`/` 开头的本机文件路径（必须在资产库文件夹里）。
- **参数的写法**：可重复的参数可以写多次，也可以用逗号分隔；JSON 参数可以写 `@文件` 从文件读。
- **搜索的文本语法**与网页搜索框相同：`stage:` `format:` `tag:` `-tag:` `folder:` `review:` `is:issue` `is:stale` `is:missing` `tris:` `dur:` `width:>=1024` `belongs:` `when:today|week|month` `by:agent`（创建者）`editor:agent:me`（最后修改者）`method:` `batch:` 加上其余文字。`<`、`>` 在命令行里要加引号：

  ```bash
  bb search stage:runtime format:model "tris:<5000" 宝箱
  bb search tag:宝箱 -tag:废弃 review:approved --json
  ```

- **登记**：资产库外的文件上传进 `--folder`；已经在资产库文件夹里的文件就地登记。`--source` 是照着做的资产，它变了会提醒「上游已更新」；`--reference` 是只参考过的资产，例如随时会重截的截图，它变了不提醒。带 `--prompt` 时方式默认 `ai-generate`。一次登记多个文件、又给了出处时，它们共用一个自动生成的批次号。已经登记过的文件再登记一次，只写有差别的部分。中途有一个失败就停下，列出已经登记的（它们留在资产库里）、失败的那个和没处理的。

  ```bash
  bb add out/chest_*.png --folder props/chest --stage production --tag 宝箱 \
    --source props/chest/chest_concept.png --role 原画 \
    --prompt "红色的卡通宝箱，四视图" --tool sdxl --param seed=7
  ```

- **按清单写入**：`bb apply` 读一份 JSONL 清单，每行一项，用 `id` 或 `path` 指明资产，写出它应该有的信息；也接受一个 JSON 数组；`-` 表示从标准输入读。内核拿它和现在的样子比，只写有差别的部分，所以同一份清单重跑不会多写。先加 `--dry-run` 看每个资产改之前、改之后是什么。一项失败不影响其他项，有失败时退出码为 1。

  ```jsonl
  {"path": "props/chest/chest_front.png", "stage": "production", "tags": {"add": ["宝箱"]}, "provenance": {"method": "ai-generate", "tool": "gpt-image-1", "prompt": "红色的卡通宝箱，正面", "params": {"seed": 7}}, "relations": {"add": [{"type": "reference", "to": "ui/shop_shot.png", "role": "原型截图"}]}}
  {"path": "props/chest/chest_side.png", "tags": {"add": ["宝箱"], "remove": ["草稿"]}, "description": "宝箱侧面"}
  ```

  ```bash
  bb apply chest.jsonl --dry-run
  bb apply chest.jsonl
  ```

  每项可写 `stage`、`tags`（`add`、`remove`）、`description`、`review`（`pending` 或 `exempt`）、`provenance`（`method`、`tool`、`prompt`、`params`、`batch`、`note`）、`relations`（`add`、`remove`；对方可以写路径）、`views`、`fields`、`auxiliary`。没写的保持原样；`description`、`provenance`、`views` 写 `null` 表示清除。
- **出处写错了**：重新说一遍对的就是改正，例如用 `bb apply` 给这个资产写新的 `provenance`。内核不做撤销：`--dry-run` 的结果里有每处改之前的值，想留后路就先存下它。
- **我这次改了什么**：`bb changes --by agent:modeler --since today` 列出这个执行者最后改过的资产，以及要提交到 Git 的文件（资产文件和它的 `.bmeta`）。不给 `--by` 时用 `BOWERBIRD_ACTOR`。
- **移出资产库**：`bb untrack` 把资产的 `.bmeta` 移入回收站（可以恢复），文件留在原处，之后只是一个被看见的文件。不想再看见它，把它写进 `.bbignore`。被 `.bbignore` 新命中的资产会自动这样移出。
- **导出**：与服务在同一台电脑上时由服务直接复制到目录；在其他电脑上时逐个下载，包式资产（作为一个资产的文件夹）逐个下载包里的文件。`--with-deps` 把模型引用的贴图等依赖一起带出，并按模型文件里写的名字写出，离开 Bowerbird 后模型仍能找到它们。
- **插件命令**直接操作这台电脑上安装的插件，不需要服务在运行；正在运行的服务重启后生效。

## MCP（给 Agent 用）

`bb mcp` 以标准输入输出提供 MCP 服务。每次调用都像一条命令那样找服务：有打开了这个资产库的服务就用它，没有就自己打开资产库。所以不需要先开 `bb serve`。

- `--name <名称>` 或环境变量 `BOWERBIRD_AGENT`：Agent 的名字，写操作记为 `agent:<名称>`。
- `--library <名称>`：MCP 客户端启动它时，工作目录不一定在资产库文件夹里，建议写上。
- `--server` 或 `BOWERBIRD_URL`：只在要用另一台电脑上的服务时写。

十四个工具，与同名命令出自同一份定义：`bb_search`（搜索）、`bb_get`（详情，可带概览图）、`bb_trace`（追溯）、`bb_add`（登记，含来源、参考、出处与四视图格子）、`bb_apply`（按想要的结果写入一批资产，`dryRun` 先看）、`bb_tag`（增删标签）、`bb_retarget`（批量更换关系的对方，先预览后执行）、`bb_export`（取文件路径或下载地址，可连同依赖导出到目录）、`bb_health`（完整性问题）、`bb_changes`（我改了什么）、`bb_rescan`（扫描）、`bb_create`（创建方式与发起创建）、`bb_action`（插件动作）、`bb_vocabulary`（词表）。**没有删除、移出资产库和处理问题的工具**，这些请在网页或命令行里做。

每条搜索结果都带物料阶段、校验状态与问题标记。资产库设置「Agent 搜索范围」改为「只返回已通过和免审的」后，Agent 没有指定校验条件的搜索只返回这两类。

Claude Code（项目里的 `.mcp.json`）或 Claude Desktop（`claude_desktop_config.json`）的配置示例。全局安装过 `bowerbird` 时：

```json
{
  "mcpServers": {
    "bowerbird": {
      "command": "bb",
      "args": ["mcp", "--name", "modeler", "--library", "星落"]
    }
  }
}
```

没有安装、让 npx 临时取用时（第一次启动要先下载依赖，可能超过客户端的启动等待时间，先在终端里运行一次 `npx -y bowerbird --version` 预热）：

```json
{
  "mcpServers": {
    "bowerbird": {
      "command": "npx",
      "args": ["-y", "bowerbird", "mcp", "--name", "modeler", "--library", "星落"]
    }
  }
}
```

发布前用本地打包装在 `~/bowerbird-local` 时，`command` 写那里的绝对路径（例如 `/Users/you/bowerbird-local/node_modules/.bin/bb`），`args` 为 `["mcp", "--name", "modeler", "--library", "星落"]`。

要用另一台电脑上的服务时，在配置里加 `"env": { "BOWERBIRD_URL": "http://192.168.1.10:7420" }`。

## HTTP 接口

网页、命令行、MCP 用的是同一套接口，基础路径 `/api/v1`，自己写脚本也可以直接调：

```bash
curl -s http://127.0.0.1:7420/api/v1/libraries
curl -s -X POST http://127.0.0.1:7420/api/v1/libraries/<库标识>/search \
  -H 'content-type: application/json' -H 'X-Bowerbird-Actor: agent:script' \
  -d '{"filter":{"stage":["runtime"]},"limit":20}'
```

- 执行者放在请求头 `X-Bowerbird-Actor`；名字含中文等非 ASCII 字符时按 URL 编码（`user:%E6%9E%97`）。
- 错误统一为 `{ "error": { "code", "message", "details" } }`，`code` 见设计文档的错误模型。
- 健康检查：`GET /api/v1/health`。
- 变化以服务器推送事件提供：`GET /api/v1/libraries/{库标识}/events`。

## Docker 部署

适合放在 NAS 或服务器上给小团队共用。镜像里不带浏览器，服务器不渲染缩略图：模型、视频的缩略图由打开页面的浏览器渲染后交回保存。

```bash
docker build -t bowerbird .
docker run -d --name bowerbird \
  -p 7420:7420 \
  -v /volume1/art/xingluo:/library \
  -v bowerbird-data:/data \
  bowerbird
```

- `/library`：资产库文件夹，启动时作为这次打开的库。
- `/data`：本机数据目录（`BOWERBIRD_HOME`），保存配置、索引、日志与安装的插件；挂成卷，重建容器后不用重新索引。
- 容器里监听 `0.0.0.0`，启动日志会打印局域网警告。上面「局域网与安全」一节全部适用：**只在可信的局域网里用，不要把端口直接暴露到公网**，需要外网访问时放在带鉴权的反向代理后面，并把对外地址加进 `/data/config.json` 的 `allowedOrigins`。
- 用 IP 地址访问（`http://192.168.1.10:7420`）可以直接用；用主机名访问（`http://nas.local:7420`）时，容器认不出这个名字，要把它加进 `/data/config.json` 的 `allowedOrigins`（`"allowedOrigins": ["http://nas.local:7420"]`）后重启容器。
- 多个资产库：多挂几个卷（例如 `-v /volume1/art/b:/libraries/b`），再在网页的资产库菜单里添加 `/libraries/b`。
- 从容器外访问时，「用默认程序打开」「在文件夹中显示」不可用，界面会换成「下载源文件」。

`docker compose` 示例：

```yaml
services:
  bowerbird:
    build: .
    ports: ["7420:7420"]
    volumes:
      - /volume1/art/xingluo:/library
      - bowerbird-data:/data
    restart: unless-stopped
volumes:
  bowerbird-data:
```
