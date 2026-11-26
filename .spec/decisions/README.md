# Decisions（决策记录 · ADR）

本目录是全仓决策的**唯一落点**：为什么这样划边界、为什么选这个方案、为什么否掉别的。功能文档只描述设计现状，不留决策记录。

## 怎么写一条 ADR

- 一个决策 = 一个文件 `ADR-NNN-<slug>.md`，编号从 `001` 递增、同目录不得撞号；写完在下方索引加一行（`/workflow:lint` 校验登记与撞号）。
- 前 12 行内必须有状态行 `状态：X`，X 取 `提议` / `Draft` / `Accepted` / `Superseded`。`提议` 是实现时自行补的决定，待评审后改为 `Accepted` 或另立一条取代。`Draft` 可随实现验证修订；`Accepted` 后不改写，要推翻就新增一条并把旧的标成 `Superseded（被 [ADR-NNN](ADR-NNN-<slug>.md) 取代）`。
- 无 frontmatter。格式照抄：

  ```markdown
  # ADR-NNN：<一句话决策>

  状态：Draft
  日期：YYYY-MM-DD

  ## 背景
  面对什么问题（大白话）。

  ## 决策
  定了什么。

  ## 替代方案与否决理由
  还考虑过什么、为什么不选。

  ## 兼容影响
  哪些文档 / 代码要跟着改（点名的知识文档须回指本 ADR 编号）。
  ```

## 索引

| 编号 | 决策 | 状态 |
|------|------|------|
| [ADR-001](ADR-001-standalone-open-source-repo.md) | 作为独立开源仓库建设，项目名定为 Bowerbird | Accepted |
| [ADR-002](ADR-002-local-first-monolith.md) | 采用本地优先的单体架构 | Accepted |
| [ADR-003](ADR-003-microkernel-and-plugins.md) | 微内核加插件，格式、搜索、AI、版本均为插件 | Accepted |
| [ADR-004](ADR-004-unity-style-library-layout.md) | 资产库采用 Unity 式目录与同名元数据文件 | Superseded（被 ADR-017 取代） |
| [ADR-005](ADR-005-assets-and-typed-relations.md) | 两层数据模型——资产加带类型的关系，来源关系记录上游版本 | Accepted |
| [ADR-006](ADR-006-stage-and-review-as-fields.md) | 物料阶段与校验状态用独立字段，不用标签 | Accepted |
| [ADR-007](ADR-007-versioning-as-optional-plugin.md) | 版本管理为可选插件，内核只记版本记录 | Accepted |
| [ADR-008](ADR-008-thumbnails-by-viewer-cache-in-library.md) | 缩略图由查看器代码生成，缓存放在资产库内，索引放在本机 | Accepted |
| [ADR-009](ADR-009-no-auth-localhost-default.md) | 内核不做登录与权限，默认只监听本机 | Accepted |
| [ADR-010](ADR-010-typescript-full-stack.md) | TypeScript 全栈，Node.js、SQLite、React、three.js | Accepted |
| [ADR-011](ADR-011-unified-api-and-agent-search-scope.md) | 网页与 Agent 共用一套接口；Agent 搜索默认返回全部资产并标明状态 | Accepted |
| [ADR-012](ADR-012-plugins-installed-per-machine.md) | 插件安装在本机，资产库不携带可执行代码 | Accepted |
| [ADR-013](ADR-013-minimize-manual-steps.md) | 流程尽量不要人工步骤，自动结果给出可信度 | Accepted |
| [ADR-014](ADR-014-auto-detect-turnaround-views.md) | 四视图的视图区域自动识别，不人工标注，结果进可重建索引 | Superseded（被 ADR-019 取代） |
| [ADR-015](ADR-015-target-size-on-design-object.md) | 目标尺寸由设计对象承载，尺寸线与各项尺寸检查都从它派生 | Superseded（被 ADR-020 取代） |
| [ADR-016](ADR-016-creation-as-extension-point.md) | 创建资产也是扩展点，插件的产出走与接口相同的登记通道 | Accepted |
| [ADR-017](ADR-017-bmeta-sidecar-suffix.md) | 元数据文件后缀改为 .bmeta，目录布局沿用 Unity 式 | Accepted |
| [ADR-018](ADR-018-replaceable-relations-and-slots.md) | 关系可以更换；文件里的引用名只当位置名，对应哪个资产以元数据文件为准 | Accepted |
| [ADR-019](ADR-019-turnaround-sheet-with-grid.md) | 四视图是一张整图，格子与视图的对应记在元数据文件里，不再自动识别 | Accepted |
| [ADR-020](ADR-020-manual-review-and-builtin-checks.md) | 校验由人决定；内置只带模型尺寸对照，合规检查靠插件扩展 | Accepted |
| [ADR-021](ADR-021-shadcn-magicui-tailwind.md) | 界面用 shadcn/ui 做基础件、Magic UI 做动效，样式用 Tailwind | Accepted |
| [ADR-022](ADR-022-3d-formats-phase-one.md) | 3D 第一期 GLB、glTF、FBX 全做，OBJ 不支持；读不出的功能点击时提示 | Accepted |
| [ADR-023](ADR-023-open-lan-and-auth-by-plugin.md) | 第一期不做访问限制；登录以后由插件提供，内核留出识别身份的扩展点 | Accepted |
| [ADR-024](ADR-024-no-change-history-in-kernel.md) | 内核不记改动历史；历史以后由插件提供，内核留出改动通知的扩展点 | Accepted |
| [ADR-025](ADR-025-lazy-thumbnails-no-headless-render.md) | 需要渲染的缩略图懒加载，服务器不渲染；缩略图随资产库同步 | Accepted |
| [ADR-026](ADR-026-multiple-libraries.md) | 一个资产库是一个根文件夹，可以有多个并切换；接口地址带上是哪个库 | Accepted |
| [ADR-027](ADR-027-asset-origin-record.md) | 资产记下产出它的生产记录（origin） | 提议 |
| [ADR-028](ADR-028-plugin-data-dir.md) | 插件上下文提供本机的插件数据目录与临时目录；关键词搜索的全文索引放在插件自己的数据库里 | 提议 |
| [ADR-029](ADR-029-api-endpoints-added.md) | 实现时补的接口端点 | 提议 |
| [ADR-030](ADR-030-plugin-web-shared-runtime.md) | 插件网页模块共用外壳的 React 与插件开发包实例，样式随模块注入 | 提议 |
| [ADR-031](ADR-031-sqlite-binding.md) | SQLite 用 better-sqlite3；内核以类型方式引用插件开发包 | 提议 |
| [ADR-032](ADR-032-no-hover-turntable-on-touch.md) | 触屏上不做悬停转台，长按进入快速预览 | 提议 |
| [ADR-033](ADR-033-add-library-runs-first-open.md) | 添加资产库时，文件夹里已有文件就走首次打开的说明与进度 | 提议 |
| [ADR-034](ADR-034-created-time-syntax.md) | 搜索语法增加 created:today\|week\|month | 提议 |
| [ADR-035](ADR-035-info-level-named-hint.md) | 问题级别的「信息」在界面上叫「提示」 | 提议 |
| [ADR-036](ADR-036-slice-compare-crops-region.md) | 切图与效果图对比时，按生产记录里的区域自动裁剪 | 提议 |
| [ADR-037](ADR-037-mark-as-copy.md) | 「标为副本」保留两个资产，在它们之间建一条复制来源关系 | 提议 |
| [ADR-038](ADR-038-concurrent-edits.md) | 两人同时修改：标签按增删提交；校验队列提交前核对内容 | 提议 |
| [ADR-039](ADR-039-image-search-entry-by-plugin.md) | 以图搜图的入口由语义搜索插件提供，内核不画 | 提议 |
| [ADR-040](ADR-040-no-activity-panel.md) | 第一期不做「活动」面板，别人的改动用提示条与胶囊提示 | 提议 |
| [ADR-041](ADR-041-bundle-keeps-slot-names.md) | 文件夹变成包式资产时，指向里面文件的关系改指向包，并保留位置名 | 提议 |
| [ADR-042](ADR-042-creator-job-follow-up.md) | 创建任务可以请使用者到插件页面做后续操作 | 提议 |
| [ADR-043](ADR-043-html-sandbox-opaque-origin.md) | HTML 资产在不带同源权限的沙箱框架里运行 | 提议 |
| [ADR-044](ADR-044-library-plugin-formats.md) | 资产库记下每个声明的插件认领哪些后缀 | 提议 |
| [ADR-045](ADR-045-duplicate-guid-copy-names.md) | 判定重复身份的原件时，名字像副本的一份是副本 | 提议 |
| [ADR-046](ADR-046-stale-sidecar-write-guard.md) | 写元数据文件前先核对磁盘上的版本 | 提议 |
| [ADR-047](ADR-047-folder-delete-respects-references.md) | 删除文件夹也遵守「被引用」规则，只移入回收站、不删除别的东西 | 提议 |
| [ADR-048](ADR-048-slot-names-are-relative-paths.md) | 位置名只能是资产库内的相对路径，导出时不得写出目标目录 | 提议 |
| [ADR-049](ADR-049-server-request-rules.md) | 服务端对请求的统一规则：主机与来源校验、本机判定、访问控制门、执行者、只写设置、状态码与范围请求 | 提议 |
| [ADR-050](ADR-050-distribution-and-cli.md) | 主包随带内置插件与构建好的外壳，`bb serve` 只托管构建好的外壳；命令行与 MCP 的环境变量、部分失败与远程导出 | 提议 |
| [ADR-051](ADR-051-reconcile-and-trash-details.md) | 扫描对账与回收站细则：落单与缺失、停放、冲突副本、库不可用、登记合并、包式资产、复制名、位置名配对、回收项 | 提议 |
| [ADR-052](ADR-052-pipeline-cache-and-jobs-details.md) | 管线、缓存与任务细则：阶段记账、缓存键与清理、渲染租约与重试、任务事件、创建与动作任务、文件监听的规模 | 提议 |
| [ADR-053](ADR-053-query-details.md) | 查询细则：文本语法执行时解析并按字段与筛选合并、相对时间、分面、附属文件、关键词权重、排序与分页 | 提议 |
| [ADR-054](ADR-054-web-shell-details.md) | 网页外壳实现细则：地址参数、瀑布流、问题计数、上传、撤销、检查器事件、浏览路径、对比方式、批量处理、参数表单 | 提议 |
| [ADR-055](ADR-055-builtin-plugins-details.md) | 内置插件实现细则：图片、视频、音频、文档、关键词搜索 | 提议 |
| [ADR-056](ADR-056-model-plugin-details.md) | 3D 模型插件实现细则：尺寸容差、附属文件、内嵌贴图、FBX、分屏与通道、缩略图、悬停转台、出图、压缩扩展 | 提议 |
| [ADR-057](ADR-057-repository-name-and-home.md) | 仓库定名 Bowerbird，放在 LumioGames 组织下 | Accepted |
| [ADR-058](ADR-058-polyform-shield-license.md) | 许可改为 PolyForm Shield 1.0.0，另加 LumioGames 的附加许可和商标说明 | Accepted |
| [ADR-059](ADR-059-plugin-packages-mit.md) | 写插件用的插件开发包、插件构建工具与共用数据结构按 MIT 许可 | Accepted |
| [ADR-060](ADR-060-shell-details-from-browser-tests.md) | 浏览器测试中补定的外壳细则：扫描结束提示、新资产胶囊、删除确认、键盘树、图标表、创建输入要四视图、完成事件节流 | 提议 |
| [ADR-061](ADR-061-ui-languages.md) | 界面多语言：语言是一张表，先做中、英、日、韩，缺的按英文、中文顺序回退 | Accepted |
| [ADR-062](ADR-062-plugin-text-languages.md) | 插件文字的多语言：清单按原文给译文，服务端写下的文字由插件网页部分按语言说出 | Accepted |
| [ADR-063](ADR-063-first-run-open-or-create.md) | 第一次使用：欢迎页给两条路——打开已有文件夹，或新建资产库 | Accepted |
