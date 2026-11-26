# ADR-049：服务端对请求的统一规则——主机与来源校验、本机判定、访问控制门、执行者、只写设置、状态码与范围请求

状态：提议
日期：2026-11-26

## 背景

api-and-agent.md 只写了「校验主机头与来源头」「本机动作只在本机执行」「访问控制由插件提供」这几个方向，没有写到能照着实现的程度。服务端实现与审查时把这些细节一条条定了下来，另外还有执行者名字的编码、带密钥的插件设置怎么读写、长操作怎么答复、范围请求做到哪一步、状态码怎么用。外壳页面后来又加了内容安全策略。

本条把第一期实现时服务端自行定下的做法合并成文（ADR-013），待评审。HTML 沙箱的 `Origin: null` 例外是 ADR-043 的细则，以本条为准。

## 决策

**主机头**
- 没有主机头或解析不了：拒绝。
- 一律接受：`localhost` 与 `*.localhost`；回环地址（`127.0.0.0/8`、`::1`、`::ffff:127.x`）；本机配置 `allowedOrigins` 里各地址的主机名。末尾的点先去掉，不比较端口。
- 服务只监听回环地址时，只接受上面这些，用本机名（例如 `mymac.local`）访问也拒绝。
- 服务监听非回环地址时，另外接受：任何 IP 字面量（容器端口映射后看到的地址事先不知道）、监听地址本身、本机的名字（各网卡地址、主机名、短名、`<短名>.local`、`<短名>.lan`）。
- 拒绝时返回 403 `forbidden`，`details.reason` 为 `host`。外壳页面、健康检查、预检请求都要过这一关。
- 允许列表只有本机配置的 `allowedOrigins`，每个请求重新读取；没有对应的环境变量与命令行参数。

**来源头**
- 没带来源头：放行，不回跨域头。
- 不是 http 或 https，或解析不了：拒绝。
- 与主机头同主机、同端口：放行，不回跨域头。
- 在 `allowedOrigins` 里：放行，回 `Access-Control-Allow-Origin: <来源>`、`Vary: Origin`、`Access-Control-Expose-Headers: Content-Range, Content-Disposition, Content-Length, Accept-Ranges`。不回 `Access-Control-Allow-Credentials`。
- 其他来源：403 `forbidden`，`details.reason` 为 `origin`。
- 预检 `OPTIONS`：来源在允许列表里才回 204，允许方法 `GET, POST, PUT, PATCH, DELETE`，允许头 `content-type, range, x-bowerbird-actor, x-bowerbird-library`，缓存 600 秒。否则返回 404。

**`Origin: null` 的例外（ADR-043 细则）**
- 来源为 `null` 一律拒绝，只有同时满足下面全部条件时放行：
  - 方法是 GET 或 HEAD，端点是包内文件 `/libraries/{library}/assets/{id}/bundle/*`；
  - `Sec-Fetch-Dest` 是 `script`、`style`、`image`、`font`、`audio`、`video`、`track`、`empty` 之一（`empty` 是页面脚本发出的 fetch 与 XHR）；
  - `Referer` 与主机头同主机、同端口，路径在同一个库、同一个资产的包内文件地址下，且后面至少还有一段。
- 放行时回 `Access-Control-Allow-Origin: null`。
- 包内文件的响应带 `Referrer-Policy: no-referrer-when-downgrade`，保证框架里的页面加载子资源时带上 `Referer`。

**文件响应与外壳页面**
- 资产文件类响应一律带 `X-Content-Type-Options: nosniff`。
- 会执行的类型（HTML、XHTML、SVG、XML）另带 `Content-Security-Policy: sandbox allow-scripts`，直接打开文件地址也在沙箱里运行。
- 外壳页面（`index.html` 与前端路由的回退）带内容安全策略，只允许本服务、`data:` 与 `blob:`：

  ```text
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self';
  object-src 'none'; base-uri 'self'; form-action 'self'
  ```

  插件查看器因此无法让浏览器去请求资产文件里写着的外部地址：打开别人的资产库，也不会往外发请求（ADR-012）。

**本机请求**
- 本机请求要同时满足两条：对端地址是回环地址；请求里没有 `X-Forwarded-For`、`Forwarded`、`X-Real-IP` 中的任何一个头。只看头有没有，空值也算有。
- 经反向代理转发的请求一律不算本机。
- 只在本机执行的操作有五个：打开资产、在文件夹中显示资产、在文件夹中显示资产库根文件夹、导出到目录、列出这台电脑上的文件夹（选文件夹对话框，ADR-063）。其他来源返回 403 `not_local`。

**访问控制门**
- 范围：`/api/v1/` 下除健康检查与预检之外的全部请求。外壳的静态页面不过门。
- 带 `{library}` 的端点：
  - 先找这个库，不存在返回 404 `not_found`；
  - 只问这个库启用的访问控制插件。
- 全局端点（包括插件自己的路由与网页模块）：
  - 问所有已登记、状态为可用或只读的库的访问控制插件，任一拒绝即拒绝；
  - 打不开的库跳过并记警告；
  - 没有可用的库时不过门。
- 全局端点按请求头 `X-Bowerbird-Library`、查询参数 `?library=`、默认库的顺序决定在哪个库上执行。这两个参数不能用来挑选把关的插件。
- 拒绝时错误码为 `forbidden`：
  - 状态默认 403，插件可以给出别的状态（例如 401）与说明；
  - 插件抛出异常时返回 500 `internal`，不放行。
- 插件返回的 `actor` 替代请求头里的执行者；多个插件都给时取第一个。

**执行者**
- 请求头写法是 `X-Bowerbird-Actor: user:<名字>` 或 `agent:<名字>`。
- 编码：
  - 名字有非 ASCII 字符或 `%` 时，客户端做百分号编码；
  - 外壳总是编码，命令行与 MCP 只在需要时编码；
  - 服务端遇到 `%XX` 就解码，再做 NFC 归一。
- 校验：名字 1 到 127 个字符，不含控制字符，不以空白开头；不合规返回 400 `validation_failed`。每个请求都校验。
- 没带时记 `user:unnamed`。

**只写设置**
- 插件设置项在清单里标 `writeOnly: true`，例如密钥。
- 读取时，已设的值换成占位 `{ "set": true }`，没设的不出现这个键。涉及的读取有四处：
  - 两个插件设置端点；
  - `GET /config`；
  - 资产库信息里的 `settings.plugins`。
- 写入时：
  - 收到占位或省略这个键：保留原值；
  - 收到 `null`：清空。
- 读不到插件的设置结构时，全部值按只写处理。

**状态码与长操作**
- 201：
  - 添加资产库、安装插件、复制；
  - 登记资产（跳过时为 200）；
  - 新建生产记录、新建文件夹、把文件夹作为一个资产。
- 202：开始扫描（`POST /rescan`，返回 `{ "started": true }`）、执行创建方式、执行动作（返回任务信息）。
- 204：
  - 打开、在文件夹中显示（资产与库根）、停止扫描；
  - 删除插件、彻底删除回收项、清空回收站；
  - 取消任务、重试任务、交回渲染结果；
  - 预检。
- 长操作先答复：首次登记（`POST /libraries/{library}/init`）与扫描最多等 300 毫秒，这段时间里出的错直接返回，之后在后台继续。首次登记返回 200 与资产库信息，进度看 `scan.progress` 事件。

**范围请求（RFC 9110）**
- 只支持单个范围：`bytes=a-b`、`bytes=a-`、`bytes=-n`。`n` 大于文件大小时，以 206 返回整个文件。
- 这些写法忽略范围、以 200 返回整个文件：多个范围、别的单位、`bytes=5-2` 这类不合法写法。
- 这些情况返回 416 `range_not_satisfiable`，带 `Content-Range: bytes */<大小>`：
  - 起点不小于文件大小；
  - `bytes=-0`；
  - 零字节文件上的任何范围。
- 不处理 `If-Range` 与条件请求，只回 `Last-Modified`。
- 支持范围的端点：资产文件、缩略图、按位置名取文件、包内文件、插件网页模块与插件网页资源。
- 版本文件与导出压缩包不支持范围。

**错误与部分失败**
- 框架自身的 4xx（请求体过大、类型不支持等）统一为 400 `validation_failed`，`details.reason` 写框架的原因；找不到路由为 404 `not_found`。
- 结构校验失败时，`details` 为 `{ issues: [{ path, message }] }`。
- 批量修改 `POST /assets/batch` 总是返回 200，结果为 `{ updated, failed: [{ id, code, message }] }`，每项不保证原子。
- 处理问题的结果为 `{ resolved, failed: [{ id, message }] }`。

## 替代方案与否决理由

- **只监听本机时也接受本机名**：只监听回环地址时，带本机名的请求只可能是被改写过的（例如 DNS 重绑定）。拒绝更稳妥。
- **按 `X-Forwarded-For` 的值判断是不是本机**：这个头可以伪造。只要出现就当远程，最保守。
- **全局端点只问 `?library=` 指定的库**：请求方可以挑一个没装访问控制插件的库，绕过把关。
- **只写设置读出时返回空串**：界面分不清「没设」和「设了但不给看」，保存时还会把密钥清空。
- **长操作同步等到完成**：十万个文件的首次登记要几分钟，请求会超时。
- **支持多个范围**：浏览器播放与断点续传只用单个范围，多段响应只增加复杂度。
- **外壳页面不加内容安全策略**：第三方插件的查看器可以把资产里写的外部地址交给浏览器去请求，打开别人的资产库就可能往外发请求。

## 兼容影响

- knowledge/features/api-and-agent.md：通用约定、错误模型、端点、事件流、安全几节。
- knowledge/features/plugin-system.md：访问控制、只写设置。
- knowledge/features/engineering.md：配置里的 `allowedOrigins`。
- ADR-043：`Sec-Fetch-Dest` 集合与 `Referrer-Policy` 以本条为准。
- ADR-023 写的「第一期不带任何实现」，在内核一侧已经不成立：访问控制门已经接上，只是还没有插件。
