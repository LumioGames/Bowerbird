# CLAUDE.md

Claude Code 入口。下面的 `@import` 行把**项目专属**文件强制载入每个会话;通用规则(调度、编码、红线)由 Workflow 插件在 SessionStart 注入,不在这里重复。权威源在 `.spec/`,本文件只加载、不定义规则。

中心文档(项目是什么 / Room 表 / 收口命令 / 专属技能名册):

@.spec/AGENTS.md

知识导航(有哪些知识、在哪):

@.spec/knowledge/README.md

项目专属红线(只放这个项目独有的,不抄插件):

@.spec/rules/system.md

> 维护:`.spec/rules/` 下每个规则文件都要在上面有一行 `@.spec/rules/<name>.md`,漏了 = 会话静默不加载(`/workflow:lint` 会报)。
