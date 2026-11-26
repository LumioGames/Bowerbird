# Bowerbird 交互原型与设计系统

第一期的交互原型、设计系统和走查交付物都在这个目录。设计文档的权威版本仍然是仓库的 `.spec/`；这里放的是「长什么样、怎么交互」。

## 目录

| 路径 | 是什么 |
|------|--------|
| `prototype/` | 可点击的高保真原型（纯 HTML/CSS + 原生 JS，3D 用 three.js r128） |
| `design-system/` | 设计系统：`tokens.json`、组件样式 `components/bundle.css`、组件脚本 `components/bundle.js`、每个组件的 `preview.html` 与 `README.md` |
| `tools/` | 构建与检查脚本（Node 18+，只读写本目录） |
| `docs/pages.md` | 页面清单：每个页面和它的全部状态 |
| `docs/components.md` | 组件清单：用到的全部组件及其变体 |
| `docs/deviations.md` | 偏离清单：相对原型提示词的改动、合并、取舍及原因 |
| `docs/copy.md` | 提示与确认框文案清单 |
| `review-prompt.md` | 用这份原型 review 程序实现的提示词 |
| `review/` | 审查报告与讨论后的结论；`review/2026-11-25-prototype-revision.md` 是按决策修订原型的说明 |
| `prototype-revision-prompt.md` | 按 ADR-016 至 ADR-026 修订并补齐原型的提示词 |
| `dev-prompt.md` | 照原型把 Bowerbird 做成正式版本的开发提示词（全自动、可并行） |

## 怎么打开

- 用本地静态服务打开 `prototype/`（例如 `python3 -m http.server 4793 --directory design/prototype`，再访问 `http://localhost:4793/index.html`）；直接用 `file://` 打开时部分功能受限。3D 查看器从 cdnjs 加载 three.js，需要联网。
- 在线版本（私有，停在修订前）：原型 https://claude.ai/artifact/WWvPEHTyFxL3f5hGgN6oVH ，设计系统 https://claude.ai/artifact/YRupzrDpLFNud4vWyZmMwm
- 左下角「图层」按钮是只给评审用的控制：页面状态（空资产库、加载中、连接失败）、四条演示路径、首次打开已有文件的文件夹、别人的改动、有无版本插件、本机 / 其他电脑、有无创建插件及其故障。它不是产品界面的一部分。
- `prototype/plugin-demo.js` 是虚构的第三方插件 Forge，只用来演示插件能占的位置，不是内核的一部分。

## 改了设计系统之后

```bash
node design/tools/proto.mjs
```

把 `design-system/` 的 tokens 与组件同步进 `prototype/bb/`，并重写 `prototype/index.html`。

```bash
node design/tools/check.mjs
```

检查颜色对比度（目前有 2 组深色模式悬停态略低于 4.5:1，见偏离清单）。

```bash
node design/tools/harness.mjs
```

把每个组件的 `preview.html` 包成可直接打开的页面，输出到 `design/.preview/`（生成物，不入库）。

## 开发时参考

程序实现要以这两份为准，原型的动效与组件风格就是照它们做的：

- Magic UI：https://github.com/magicuidesign/magicui
- Apple 设计技能（Emil Kowalski）：https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md

原型是纯 HTML 写的，程序用 React，界面基础组件用 shadcn/ui、动效用 Magic UI、样式用 Tailwind，设计系统的变量照用（见 `.spec/decisions/ADR-010`、`ADR-021`）。原型里的命令式写法不要照搬，照搬的是界面结构、状态、文案和交互规则。
