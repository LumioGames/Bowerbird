# ADR-031：SQLite 用 better-sqlite3；内核以类型方式引用插件开发包

状态：提议
日期：2026-11-25

## 背景

engineering.md 的待解决项：SQLite 的 Node.js 绑定选内置模块还是第三方模块，取决于全文检索扩展。另外内核的插件宿主要实现插件开发包里定义的接口。

本条是第一期实现时按「先找最接近的已有决定，找不到就选更少人工步骤、更不容易丢数据的做法」（ADR-013）补的，待评审。

## 决策

- 用 `better-sqlite3`：同步接口、带 FTS5（含 trigram 分词）、各平台有预编译包；Node 22 的内置 `node:sqlite` 仍标为实验性。
- `core` 只以 `import type` 引用 `@bowerbird/plugin-sdk` 的接口类型，运行时不依赖它；两条硬约束（内核不引用具体插件、插件只依赖插件开发包）不变。

## 替代方案与否决理由

- **`node:sqlite`**：不用编译，但在当前长期支持版上会打印实验性警告，接口仍可能变。
- **把插件接口类型挪进 `schema`**：`schema` 只放数据结构，插件接口放在插件开发包更好找。

## 兼容影响

- knowledge/features/engineering.md 技术选型与依赖表。
