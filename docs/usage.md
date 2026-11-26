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
- 文件夹里已经有文件、但还不是资产库时，网页上会先说明首次打开会做什么（在每个文件旁写一个 `.bmeta` 元数据文件、哪些格式还没有插件能读），确认后才开始登记；登记可以停止，下次接着做。
- 第一次在一个浏览器里打开有资产的库时，浏览页会走一个五步的导览；其他页面第一次打开时，一个小手指指着那页最主要的按钮说一句话；网格里第一次出现某类文件时，也会指着它说这种文件能做什么。左栏左下角的「?」里可以重新看导览，或者关掉这些提示。
- 只想把文件夹初始化为资产库、不启动服务时用 `bb init <目录>`。
- 不带目录的 `bb serve` 打开之前登记过的资产库。

**启动参数与环境变量**（优先级高于本机配置）：

| 参数 / 变量 | 作用 | 默认 |
|-------------|------|------|
| `--host <地址>` | 监听地址 | `127.0.0.1` |
| `--port <端口>` | 端口 | `7420` |
| `BOWERBIRD_HOME` | 本机数据目录：本机配置、索引、日志、安装的插件、临时文件 | `~/.bowerbird` |

**数据放在哪**：

- 资产库文件夹是唯一真值：资产文件、旁边的 `.bmeta`、`.bowerbird/` 下的库级数据（库设置、标签定义、生产记录、智能文件夹、缩略图缓存）。整个文件夹可以用任何同步工具同步。
- 本机数据目录（`BOWERBIRD_HOME`）里的索引都能从资产库重建，删掉后重新启动会重建。

## 多个资产库

一个资产库就是一个根文件夹，一个 Bowerbird 可以登记多个：

- 每次 `bb serve <目录>` 都会把目录登记进本机配置；也可以在网页的资产库菜单里「添加资产库…」。
- 在网页上切换资产库只影响自己的浏览器，不影响别人正在看的页面。
- 接口地址里带着库的标识：`/api/v1/libraries/{库标识}/…`。命令行用 `--library <库标识>` 指定，不指定时用服务的默认库（这次 `bb serve` 打开的那个）。
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

除 `init`、`serve`、`plugin`、`mcp` 外，命令都通过 HTTP 接口与正在运行的服务通信：

| 选项 / 变量 | 作用 | 默认 |
|-------------|------|------|
| `--server <地址>` / `BOWERBIRD_URL` | 服务地址 | `http://127.0.0.1:7420` |
| `--library <库标识>` | 资产库 | 服务的默认库 |
| `BOWERBIRD_ACTOR` | 写操作记下的执行者，例如 `user:lin` 或 `agent:modeler`；只写名字时当作 `user:<名字>` | `user:unnamed`（未署名） |

| 命令 | 作用 |
|------|------|
| `bb init <目录> [--name 名称]` | 把一个文件夹初始化为资产库 |
| `bb serve [目录] [--host] [--port]` | 启动服务 |
| `bb search <查询>` | 搜索，支持文本语法 |
| `bb get <GUID 或路径>` | 详情 |
| `bb trace <GUID 或路径> [--direction up\|down\|both] [--types source,uses] [--depth 5]` | 追溯 |
| `bb add <文件…> [--folder] [--stage] [--tag] [--description] [--source] [--prompt] [--method] [--tool] [--on-conflict]` | 登记资产 |
| `bb tag <GUID…> [--add 标签] [--remove 标签]` | 增删标签 |
| `bb export <GUID…> --to <目录> [--with-deps] [--flat]` | 导出 |
| `bb health [--type] [--level]` | 列出完整性问题 |
| `bb rescan [文件夹]` | 触发扫描 |
| `bb rm <GUID…> [--force]` | 移入回收站；被引用时需要 `--force` |
| `bb plugin add <包名或路径>` / `list` / `update [标识]` / `remove <标识>` | 插件管理 |
| `bb mcp [--name 名称]` | 启动 MCP 服务 |

说明：

- **资产的写法**：GUID；资产库内的相对路径（`props/chest.glb`）；或以 `./`、`../`、`/` 开头的本机文件路径（必须在资产库文件夹里）。
- **搜索的文本语法**与网页搜索框相同：`stage:` `format:` `tag:` `-tag:` `folder:` `review:` `is:issue` `is:stale` `is:missing` `tris:` `dur:` `width:>=1024` `belongs:` `when:today|week|month` `by:agent` `method:` 加上其余文字。`<`、`>` 在命令行里要加引号：

  ```bash
  bb search stage:runtime format:model "tris:<5000" 宝箱
  bb search tag:宝箱 -tag:废弃 review:approved --json
  ```

- **登记**：资产库外的文件上传进 `--folder`；已经在资产库文件夹里的文件（服务在同一台电脑上时）就地登记。带 `--prompt` 时写一条生产记录，方式默认 `ai-generate`；`--source` 建立来源关系并作为记录的输入。一次登记多个文件时，它们共用同一条生产记录；中途有一个失败就停下，列出已经登记的（它们留在资产库里）、失败的那个和没处理的。

  ```bash
  bb add out/chest_*.png --folder props/chest --stage production --tag 宝箱 \
    --source props/chest/chest_concept.png --prompt "红色的卡通宝箱，四视图" --tool sdxl
  ```

- **导出**：与服务在同一台电脑上时由服务直接复制到目录；在其他电脑上时逐个下载，包式资产（作为一个资产的文件夹）逐个下载包里的文件。`--with-deps` 把模型引用的贴图等依赖一起带出，并按模型文件里写的名字写出，离开 Bowerbird 后模型仍能找到它们。
- **插件命令**直接操作这台电脑上安装的插件，不需要服务在运行；正在运行的服务重启后生效。

## MCP（给 Agent 用）

`bb mcp` 以标准输入输出提供 MCP 服务，通过 HTTP 接口访问正在运行的 Bowerbird，所以先要有一个 `bb serve` 在运行。

- `--name <名称>` 或环境变量 `BOWERBIRD_AGENT`：Agent 的名字，写操作记为 `agent:<名称>`。
- `--server`、`--library` 与 `BOWERBIRD_URL` 同命令行。

十个工具：`bb_search`（搜索）、`bb_get`（详情，可带概览图）、`bb_trace`（追溯）、`bb_register`（登记，含关系、生产记录与四视图格子）、`bb_update`（标签、描述、阶段、关系；批量更换先预览后执行）、`bb_fetch`（取文件路径或下载地址，可连同依赖导出到目录）、`bb_creators` 与 `bb_create`（创建方式与发起创建）、`bb_vocabulary`（词表）、`bb_health`（完整性问题）。**没有删除工具**，删除请在网页或命令行里做。

每条搜索结果都带物料阶段、校验状态与问题标记。资产库设置「Agent 搜索范围」改为「只返回已通过和免审的」后，Agent 没有指定校验条件的搜索只返回这两类。

Claude Code（项目里的 `.mcp.json`）或 Claude Desktop（`claude_desktop_config.json`）的配置示例。全局安装过 `bowerbird` 时：

```json
{
  "mcpServers": {
    "bowerbird": {
      "command": "bb",
      "args": ["mcp", "--name", "modeler"],
      "env": { "BOWERBIRD_URL": "http://127.0.0.1:7420" }
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
      "args": ["-y", "bowerbird", "mcp", "--name", "modeler"],
      "env": { "BOWERBIRD_URL": "http://127.0.0.1:7420" }
    }
  }
}
```

发布前用本地打包装在 `~/bowerbird-local` 时，`command` 写那里的绝对路径（例如 `/Users/you/bowerbird-local/node_modules/.bin/bb`），`args` 为 `["mcp", "--name", "modeler"]`。

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
