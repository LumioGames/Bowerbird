# ADR-057：仓库定名 Bowerbird，放在 LumioGames 组织下

状态：Accepted
日期：2026-11-26

## 背景

- 项目名一直叫 Bowerbird，但本地目录与仓库仍沿用早期的 `LGArtStudio`。
- 总览的待解决里记着两件事：项目名在 GitHub 与 npm 上是否可用；目录要不要改名。
- 使用者在实现阶段定下：仓库改名，并上传到组织仓库 LumioGames。

## 决策

- 仓库名为 `Bowerbird`，地址 `https://github.com/LumioGames/Bowerbird`。
- 发布到 npm 的各包在 `package.json` 里用这个地址填 `repository`、`homepage`、`bugs`；`repository.directory` 写包在仓库里的目录。
- 包名不变：主包 `bowerbird`，其余在 `@bowerbird/` 作用域下。
- Docker 镜像发布时用 `ghcr.io/lumiogames/bowerbird`。
- 本地目录改名为 `Bowerbird` 由使用者在关掉正在运行的会话后自己做；代码与文档不依赖目录名。
- 许可保持 MIT（ADR-010），版权署名为「LumioGames and Bowerbird contributors」。

## 理由

- 仓库名与产品名、包名一致，使用者和 Agent 拿到地址就知道是什么。
- 放在组织下而不是个人账号下，方便以后多人维护。

## 影响

- 推送与发包仍由使用者执行；交回报告给出命令。
- 核实结果（2026-11-26）：`github.com/LumioGames/Bowerbird` 尚不存在，npm 上 `bowerbird` 与 `@bowerbird/core` 都未被占用；`@bowerbird` 作用域要由发布者在 npm 上建组织后才能发布。
