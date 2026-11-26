# ADR-050：主包随带内置插件与构建好的外壳，`bb serve` 只托管构建好的外壳；命令行与 MCP 的环境变量、部分失败与远程导出

状态：提议
日期：2026-11-26

## 背景

engineering.md 写了「发布 `bowerbird` 主包，包含内核、服务、已构建的网页、命令行和六个内置插件」，没写包里怎么摆、命令行怎么找到外壳与插件。实现时出现过 `bb serve` 托管 `packages/web` 源码导致白屏的问题。

命令行与 MCP 也有几处文档没写的做法：
- 执行者名字从哪来；
- 一次登记多个文件、中途失败怎么回报；
- 不在服务那台电脑上时导出怎么做。

本条把第一期实现时自行定下的做法合并成文（ADR-013），待评审。

## 决策

**主包的结构**
- `@bowerbird/cli` 提供命令入口，`bb` 与 `bowerbird` 两个命令指向同一个入口；它另外导出 `main(argv, { pluginsDir, webDir })`，给包装用的主包调用。
- 主包 `bowerbird` 只做包装：依赖 `@bowerbird/cli`，包内带 `plugins/`（六个内置插件的构建结果）与 `web/`（构建好的外壳）。
- `@bowerbird/*` 各包用同一个版本号一起发布。`@bowerbird/web` 是私有包，只以构建产物的形式进主包。

**`bb serve` 托管什么**
- 只托管构建好的外壳：目录里有 `index.html` 与 `assets/`，且 `index.html` 不引用 `/src/`。
- 从命令所在位置向上最多找 6 层，先找 `packages/web/dist`（在代码库里运行时），再找 `web/`（主包里）。
- 找不到时服务只提供接口，提示「没有找到构建好的网页外壳，只提供接口（先运行 pnpm build）」，`--json` 输出里 `webDir` 为 `null`。
- 从不托管 `packages/web` 的源码：没有开发服务器时，源码页面打开是白屏。

**启动**
- `bb serve <目录>` 与 `bb init <目录>` 在目录不存在时先创建。
- `--host` 与 `--port` 只作用于这次运行，不写入本机配置。

**环境变量**

| 变量 | 作用 | 默认 |
|------|------|------|
| `BOWERBIRD_URL` | 命令行与 `bb mcp` 连接的服务；`--server` 优先 | `http://127.0.0.1:7420` |
| `BOWERBIRD_ACTOR` | 命令行写操作的执行者，要带 `user:` 或 `agent:` 前缀 | 不带，服务端记 `user:unnamed` |
| `BOWERBIRD_AGENT` | `bb mcp` 的 Agent 名字；`--name` 优先 | 记 `agent:unnamed` |
| `BOWERBIRD_HOME` | 本机数据目录 | `~/.bowerbird`；镜像里是 `/data` |
| `BOWERBIRD_LOG_LEVEL` | 日志最低级别：debug、info、warn、error | `info` |

- `bb mcp` 把名字原样交给 MCP，由 MCP 补上 `agent:` 前缀，只编码一次（编码规则见 ADR-049）。

**部分失败的回报**
- `bb add` 按顺序登记，遇到第一个失败就停，已登记的留在资产库里。
  - `--json` 输出为 `{ registered: [{ file, result }], failed: null | { file, error, notRun }, recordId? }`，退出码 1。
  - 共用的生产记录建不成、或 `--source` 找不到时，一个都不登记。
- `bb rm` 逐个处理并收集失败，输出 `{ trashed, failed: [{ ref, code, message }] }`；有失败时退出码 1。
- MCP 的 `bb_register` 与 `bb_update` 失败时回报三段：失败前已完成的步骤、失败的那一步与错误、还有几步没执行。
- `--json` 下的错误一律输出 `{ error: { code, message, details? } }`，退出码 1。

**远程导出**
- 命令行或 MCP 与服务在同一台电脑上时（服务判定为本机请求，且资产库根目录在本机能看到），请服务直接写到目标目录。
- 否则先用 `POST /export/plan` 取文件清单，再逐个下载写到本机目录。
- 网页的导出走压缩包下载。

## 替代方案与否决理由

- **`bb serve` 找不到构建产物时托管源码或现场构建**：托管源码是白屏；现场构建要装开发依赖，也很慢。
- **主包把内核、服务、外壳打成一个大包**：插件开发包要单独给第三方用，拆成包、主包只做包装，更容易维护。
- **`bb add` 失败时把已登记的回滚**：文件已经写进资产库，回滚不干净，还可能丢掉别人刚做的改动（ADR-013）。
- **远程导出由命令行下载压缩包再解压**：要在服务端整包生成，本机还要再占一份空间。逐个下载复用文件端点，失败了可以单个重试。

## 兼容影响

- knowledge/features/engineering.md：构建与分发、配置、启动。
- knowledge/features/api-and-agent.md：命令行、MCP、执行者。
- 主包 `bowerbird` 的组装与发布脚本还没有做。命令行已经支持主包里的目录结构，代码库里运行时用 `packages/web/dist` 与 `plugins/*`。
- 使用文档 `docs/usage.md` 里的 `npm i -g bowerbird` 要等主包发布后才成立。
