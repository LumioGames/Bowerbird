# ADR-029：实现时补的接口端点

状态：提议
日期：2026-11-25

## 背景

按原型逐页实现时，有几处界面需要的操作在接口文档里没有端点。外壳不能用 Agent 调不到的私有接口（ADR-011），只能补成公开端点。

本条是第一期实现时按「先找最接近的已有决定，找不到就选更少人工步骤、更不容易丢数据的做法」（ADR-013）补的，待评审。

## 决策

新增以下端点（全部在 `/api/v1` 下，库内接口带 `/libraries/{library}` 前缀）：
- `POST /libraries`：添加资产库（文件夹 + 名称）。
- `POST /libraries/{library}/init`：首次打开已有文件的文件夹时，开始登记；`POST /libraries/{library}/rescan/stop`：停止扫描或登记，下次接着做。
- `GET /assets/{id}/slots/{slot}`：按位置名取依赖文件（`FileSource` 的位置名读取，ADR-018）。
- `GET /assets/{id}/bundle/*`：包式资产里的文件（网页原型从入口文件运行）。
- `POST /folders/bundle`：把文件夹作为一个资产（包式资产只能显式创建）。
- `POST /export/plan`：导出前列出将写出的文件（导出对话框的文件列表与大小）。
- `POST /export` 也接受普通表单（`application/x-www-form-urlencoded`，字段 `ids`、`withDeps`、`layout`、`name`），浏览器直接把压缩包边收边存，页面不必把整个压缩包读进内存。表单只能下载：带 `dir` 的表单按 `validation_failed` 拒绝，导出到目录仍只走 JSON 请求，跨站表单发不出 JSON，碰不到本机写入。JSON 请求可以用 `?name=` 指定下载文件名。压缩包是流式输出，文件名用 UTF-8。
- `GET /health`：健康检查（engineering.md 已要求，接口文档补上路径）。
- `GET|PUT /libraries/{library}/plugins/{id}/settings`：随资产库走的插件设置，与本机设置的全局端点分开。
- `POST /libraries/{library}/reveal`：在文件夹中显示资产库根文件夹（资产库菜单，只接受本机请求）。
- `GET /actions?ids=…` 与 `POST /actions/{id}/runs`：列出适用于所选资产的插件动作、在所选资产上执行一个动作（右键菜单里的插件动作；执行是一个任务，产出走登记通道）。
- 错误码增加 `forbidden`（403，主机头/来源头校验或访问控制插件拒绝）与 `range_not_satisfiable`（416，范围请求超出文件）。
- `GET /fs/folders?path=`：选文件夹对话框（打开文件夹、新建资产库）列出服务所在电脑上的文件夹，返回 `{ path, parent, home, library, folders: [{ name, path, library }], truncated }`。只列文件夹，不列以点开头的，按名称排序，最多 2,000 个（超出时 `truncated` 为真）；`library` 表示已有 `.bowerbird/library.json`；不给路径时列主文件夹，`~` 按主文件夹展开；路径不是绝对路径、不存在、不是文件夹或读不了返回 400 `validation_failed`（`details.reason` 写原因）。只接受本机请求，其他来源返回 403 `not_local`，页面只留直接输入路径。同时 `POST /libraries` 增加 `create`（新建资产库）：文件夹已存在且里面有内容时返回 409 `conflict`（`details.reason` 为 `not_empty`），不登记。

## 替代方案与否决理由

- **把这些操作塞进已有端点的参数里**：例如用 `POST /rescan` 带标记表示首次登记。语义混在一起，Agent 不好用。

## 兼容影响

- knowledge/features/api-and-agent.md 端点表。
- packages/schema 的 `ENDPOINTS` 与客户端。
