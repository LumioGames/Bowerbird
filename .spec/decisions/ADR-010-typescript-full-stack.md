# ADR-010：TypeScript 全栈，Node.js、SQLite、React、three.js

状态：Accepted
日期：2026-11-25

## 背景

需要为服务端、网页、插件、命令行选定技术栈。约束是：插件同时有服务端部分和网页部分；查看器的渲染代码要复用于缩略图生成；项目开源，要求一条命令安装启动；需要对接 MCP，以后还要对接 Lore。

## 决策

- 语言：全部使用 TypeScript。
- 服务端：Node.js 长期支持版，HTTP 框架用 Fastify。
- 索引：内嵌 SQLite，全文检索用其内置扩展。
- 网页：React 加 Vite；3D 渲染用 three.js。
- 代码库：pnpm 工作区的单代码库，内核、服务、网页外壳、插件开发包、内置插件、命令行、MCP 各为一个包。
- 分发：npm 主包与 Docker 镜像。
- 许可证：MIT。

## 替代方案与否决理由

- **Python 服务端加 TypeScript 网页**：Python 在 AI 与资产处理方面生态更好，但插件要用两种语言写两半，查看器代码无法在服务端与网页间共享。AI 与重型处理可以由插件调用外部工具或服务完成。
- **Rust 或 Go 编译为单个可执行文件**：分发最简单、性能好，但插件难以用同一种语言同时覆盖服务端与网页，第三方写插件的门槛高。
- **Babylon.js 代替 three.js**：自带更完整的检查工具，但生态与可用的加载器、示例不如 three.js 丰富，包体更大。
- **独立数据库（如 PostgreSQL）**：并发与规模能力更强，但破坏“一条命令启动、无外部服务”。

## 兼容影响

- knowledge/features/engineering.md 定义技术选型、包划分与测试策略。
- knowledge/features/plugin-system.md 的插件以 npm 包形式分发，界面用 React 编写。
