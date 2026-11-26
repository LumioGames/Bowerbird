# 项目中心文档

本项目使用 Workflow 插件（`workflow`）的调度与编码规程。**通用规则在插件 `rules/`，由 SessionStart 钩子每次会话注入；无钩子的宿主请主动读插件 `rules/` 下的文件。** 本文件只写「这个项目是什么、定过什么」，不复制插件任何一段——`/workflow:lint` 的指纹检查会把抄来的段落报出来。

## 项目是什么

**Bowerbird** 是一个网页版的游戏资产管理器，源码公开（ADR-058）：把图片、视频、音频、3D 模型、文档等资产放进一个磁盘文件夹统一管理，供人浏览、预览、校验、追溯，也供 Agent 检索与取用。

- **技术栈**：TypeScript 全栈；Node.js 服务端，SQLite 索引，React 加 three.js 的网页外壳；pnpm 单代码库。
- **关键边界**：
  - 内核不认识任何文件格式、AI 服务或版本控制系统，这些能力一律做成插件。
  - 磁盘上的资产库文件夹是唯一真值，索引与缓存都可重建。
  - 内核不做登录、账号与权限。
- **当前阶段**：第一期已实现。交互原型在 `design/prototype/`，代码在 `packages/`（内核、服务、外壳、命令行、MCP、插件开发包）与 `plugins/`（六个内置插件），样例资产库由 `fixtures/scripts/` 生成（不进仓库）。实现中补的决定见 ADR-027 至 ADR-056（提议）与 ADR-057（仓库定名，Accepted）。仓库：`github.com/LumioGames/Bowerbird`。
- **入口**：从 [`knowledge/features/overview.md`](knowledge/features/overview.md) 读起。

## Workflow 指针

本项目关心的 Room 表（手工维护，很少变；单号真值在线上）：

| Room | 单号前缀 | 管什么 |
|------|----------|--------|
| （尚未绑定 Workflow 项目，绑定后填写） | — | — |

- 遇到单号、或想知道线上有什么：先 `GET /search`（或 Room overview），再看本地索引；状态以线上 transitions 为准，不凭本地记忆流转。
- 项目绑定用仓根 `.workflow`（只含 `profile` 名，不含 token），由 `/workflow:setup` 写入。

## 收口命令

需要 Node 22（`>=22.12`）与 pnpm 10。浏览器测试与性能基准要先构建，并需要 Chromium。测试用的样例资产库不进仓库，`pnpm test` / `pnpm e2e` 第一次跑时生成（`pnpm fixtures` 强制重新生成），需要 ffmpeg。

```bash
pnpm install && pnpm build && pnpm test   # 安装、全仓构建、全部单元与集成测试
pnpm e2e                                  # 浏览器测试（Playwright）
node tests/perf/run-perf.mjs              # 十万资产的性能基准
/workflow:lint                            # 文档结构体检
```

## 专属技能名册

- 无

## 知识与决策

- 知识导航：[`knowledge/README.md`](knowledge/README.md)
- 决策唯一落点：[`decisions/`](decisions/README.md)（ADR；Accepted 后不改写，只新增取代）
- 项目专属红线：[`rules/system.md`](rules/system.md)（只放这个项目独有的）
- 结构体检扩展：[`tools/lint-extensions.mjs`](tools/lint-extensions.mjs)（可选；通用项在插件里）
