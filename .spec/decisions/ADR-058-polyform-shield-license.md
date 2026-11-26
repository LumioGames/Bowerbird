# ADR-058：许可改为 PolyForm Shield 1.0.0，另加 LumioGames 的附加许可和商标说明

状态：Accepted
日期：2026-11-26

## 背景

- 之前的几条决定都按开源处理：
  - ADR-001 把 Bowerbird 定位为开源的通用资产管理内核；
  - ADR-010 定许可证为 MIT；
  - ADR-057 写了「许可保持 MIT」。
- 仓库放到 LumioGames 组织下之后，使用者要求许可与组织里的 LGUI 一致。LGUI 源码公开，用 PolyForm Shield 1.0.0，另加 LumioGames 的附加许可和商标说明。

## 决策

**许可**
- 采用 PolyForm Shield License 1.0.0，另加 LumioGames 的附加许可和商标说明，全文在仓库根目录 `LICENSE`。
- 结构与 LGUI 的 LICENSE 相同，PolyForm Shield 的正文逐字一致。改动只在描述产品的几处：Required Notice、Licensor Line of Business、附加许可、竞品范围、商标。
- 附加许可有四条：
  1. 自己的资产与产品：个人、团队、公司都可以用它管理自己的游戏、应用、网站的资产，包括商业项目。
  2. 插件：可以用插件开发包和构建工具写插件并发布，包括收费的。插件自己的代码用什么许可由作者定。这一条 LGUI 没有，是 Bowerbird 特有的：Bowerbird 插件优先（ADR-003），第三方插件与内置插件走同一套接口。
  3. fork 与贡献。
  4. 学习、教学、研究。
- 竞品范围：资产管理器、数字资产管理系统、游戏开发工具，且提供与本软件或其任何部分相同或实质相似的功能；换名或换皮的副本也算，收费、免费都算。
- 商标：「Bowerbird」「Lumio」「LumioGames」与 Lumio 图标。

**措辞**
- 对外写「源码公开」，不再写「开源」。
- 独立仓库、项目名与「通用资产管理内核」的定位不变。

**随包分发**
- 各包 `package.json` 的 `license` 字段写 `SEE LICENSE IN LICENSE`。
- 打包时由 `scripts/copy-legal.mjs` 把 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 复制进每个发布包，以及主包里的每个内置插件。复制件不进 git，根目录的两份是唯一来源。

**第三方组件**
- `THIRD_PARTY_NOTICES.md` 由 `scripts/third-party-notices.mjs` 按构建结果生成（`pnpm notices`），不手改。
- 它读取网页外壳与各插件网页模块的源码映射、插件开发包网页模块里的模块注释，列出实际打包进发布包的第三方包，以及改写进源码的 shadcn/ui 与 Magic UI，并附许可原文。
- 打包前核对它与构建结果一致，不一致就拒绝打包。

**旧版本**
- 换许可之前没有推送过任何提交，也没有发布过任何版本，所以不存在仍按 MIT 的发布物。

## 取代

本条只取代下面三处，各条的其余内容不变：
- ADR-001「定位为开源的通用资产管理内核」中的「开源」，改为「源码公开」。
- ADR-010「许可证：MIT」。
- ADR-057「许可保持 MIT（ADR-010），版权署名为『LumioGames and Bowerbird contributors』」。版权署名改为「LumioGames (https://lumio.games)」，与 LGUI 一致。

## 理由

- 与组织里已有的项目用同一套许可，使用者和贡献者只需要理解一种条款。
- 自用不受限制，包括商业项目；限制只落在拿它去做同类产品。

## 影响

- README、使用说明、设计文档里的「开源」改为「源码公开」；README 的「许可」一节照 LGUI 的写法。
- knowledge/features/engineering.md 技术选型的许可证一行。
- 插件作者：`@bowerbird/plugin-sdk` 与 `@bowerbird/plugin-build` 也在本许可下；插件自己的代码不受影响（附加许可第 2 条）。
