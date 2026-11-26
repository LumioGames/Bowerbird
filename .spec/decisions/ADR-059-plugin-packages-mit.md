# ADR-059：写插件用的插件开发包、插件构建工具与共用数据结构按 MIT 许可

状态：Accepted
日期：2026-11-26

## 背景

- ADR-058 把整个仓库改为 PolyForm Shield 1.0.0 加 LumioGames 的附加许可，其中附加许可第 2 条允许写插件并发布。
- 但插件要依赖的几个包本身仍在 PolyForm Shield 下，插件作者还得读懂那套条款。
- 使用者定下：插件这一层应该是开放的，用 MIT。

## 决策

**按 MIT 的包**
- 插件写出来要依赖的三个包，改按 MIT 许可：
  - `@bowerbird/plugin-sdk`（`packages/plugin-sdk`）：插件接口、界面组件、主题、测试工具；
  - `@bowerbird/plugin-build`（`packages/plugin-build`）：插件网页部分的构建工具；
  - `@bowerbird/schema`（`packages/schema`）：插件与接口共用的数据结构，插件开发包在运行时依赖它。
- 三个包各自带一份 `LICENSE`（MIT，Copyright (c) 2026 LumioGames），提交进仓库；`package.json` 的 `license` 写 `MIT`。
- 打包时这三个包只复制 `THIRD_PARTY_NOTICES.md`，保留自己的 `LICENSE`。插件开发包的网页模块里打包了第三方组件，所以仍要带这份说明。

**其余部分**
- 内核、服务、网页外壳、命令行、MCP、主包与六个内置插件仍按 ADR-058。
- 根目录 `LICENSE` 加一段「Parts under the MIT License」，写明上面三个包除外。
- 附加许可第 2 条改为：插件可以用任何许可发布，包括收费；写插件用的三个包按 MIT。

## 取代

- ADR-058 中「插件开发包与构建工具也在本许可下」一句（影响一节）。

## 理由

- Bowerbird 插件优先（ADR-003），第三方插件与内置插件用同一套接口。插件生态越容易进入越好：MIT 是插件作者最熟悉的许可，不用再判断自己的插件算不算竞品。
- 这三个包只有接口、组件与构建工具，不含资产管理本身的功能，开放它们不影响 ADR-058 对产品本身的保护。

## 影响

- README 的「许可」一节、`docs/plugin-development.md`、knowledge/features/engineering.md 的许可证一行。
- `packages/cli/src/package.test.ts` 检查三个包是 MIT 且带自己的 LICENSE，其余包指向根目录 LICENSE。
