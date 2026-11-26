---
name: knowledge
description: 项目知识库导航——查「某事怎么做」(standards)或「某功能怎么设计的」(features)时，从这里找到对应 .md
metadata:
  type: index
---

# Knowledge（项目知识库 · 导航）

本文件是 `knowledge/` 下所有 .md 的导航：一行描述 + 路径，按需下钻。

> **导航行与各文档 frontmatter `description` 同一句话口径，只写「是什么 + 何时查」。** 交付历史在 git，不进文档；长度 / status 枚举 / 登记覆盖 / 链接可达由 `/workflow:lint` 机械校验。

## standards/（开发规范 · 要遵守的「怎么做」）

| 文档 | 一句话 |
|------|--------|
| — | （暂无；新增规范文档放 `standards/`，并在此登记一行） |

## features/（功能设计与记录 · 供了解）

建议阅读顺序：先读总览，再按需要进入具体模块。

| 文档 | 一句话 |
|------|--------|
| [`features/overview.md`](features/overview.md) | Bowerbird 总览——产品定位、目标与非目标、整体架构分层、模块地图、分期与术语表；初次了解项目或找某个模块的文档时查 |
| [`features/data-model.md`](features/data-model.md) | 数据模型——资产、GUID 与内容指纹、物料阶段、标签、校验状态、三种关系、生产记录、版本记录的定义与不变量；改字段或关系语义时查 |
| [`features/library-format.md`](features/library-format.md) | 资产库磁盘格式——目录布局、.bmeta 元数据文件结构、文件夹设置、包式资产、.bowerbird 库级数据、本机数据目录与忽略规则；读写磁盘格式时查 |
| [`features/sync-and-integrity.md`](features/sync-and-integrity.md) | 扫描对账与完整性——扫描器触发方式、每条对账规则、复制移动删除的语义、回收站、完整性问题类型与处理；排查引用丢失或外部改动行为时查 |
| [`features/pipeline-and-cache.md`](features/pipeline-and-cache.md) | 任务管线与缓存——入库处理的各阶段、任务队列与状态、失败重试、缩略图规格、浏览器渲染工作者、缓存键与清理、索引结构；排查缩略图或处理任务时查 |
| [`features/plugin-system.md`](features/plugin-system.md) | 插件系统——插件包结构、清单字段、生命周期、十二类扩展点的接口、安装更新、版本兼容与信任模型；写插件或改扩展点接口时查 |
| [`features/search.md`](features/search.md) | 搜索——查询模型、结构化筛选字段与文本语法、关键词与语义检索的分工、结果融合、排序分页、智能文件夹；改搜索行为或写搜索插件时查 |
| [`features/api-and-agent.md`](features/api-and-agent.md) | 接口与 Agent——HTTP API 端点、错误模型、事件流、执行者留痕、MCP 工具、命令行、Agent 摘要与标签治理、监听地址与安全；对接 Agent 或改接口时查 |
| [`features/web-shell.md`](features/web-shell.md) | 网页外壳——页面清单、三栏布局、网格与检查器、详情与对比视图、关系图、校验与完整性流程、插槽、状态与性能目标；做交互原型或改界面时查 |
| [`features/onboarding.md`](features/onboarding.md) | 新手引导——浏览页的五步导览、各页第一次打开时的小手指提示、新类型文件的提示、左下角「?」、按浏览器记住看过什么；改引导或加提示时查 |
| [`features/builtin-plugins.md`](features/builtin-plugins.md) | 内置插件——图片、视频、音频、3D 模型、文档、关键词搜索各自支持的格式、提取的信息、缩略图、查看器与对比能力，含模型查看器的完整功能、四视图的格子与目标尺寸；做某类格式的支持时查 |
| [`features/versioning.md`](features/versioning.md) | 版本管理——内核自带的版本记录、版本存储扩展点的接口、Lore 与 Git LFS 两个可选插件的设计要点、有无插件时界面的差异；做版本相关功能或写版本插件时查 |
| [`features/engineering.md`](features/engineering.md) | 工程结构——技术选型、代码库的包划分与依赖方向、构建与分发、配置、日志、测试策略与性能基准；搭建工程、加新包或定测试方式时查 |
| [`features/_TEMPLATE.md`](features/_TEMPLATE.md) | 新功能文档模板——新增功能记录时照此建 |

---

新增 / 修改 / 维护知识文档（放哪、frontmatter、同步本导航）→ 用 `spec-steward` 技能；决策记录（唯一落点）→ [`../decisions/`](../decisions/README.md)。
