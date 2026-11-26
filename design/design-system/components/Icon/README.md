图标取自 Lucide（0.460.0，ISC 许可），线条风格，随文字颜色走。

**你提供**：图标名。原型里用 `Bowerbird.icon(name, cls)` 得到内联 SVG；正式实现直接用 `lucide-react` 的同名图标。

- 默认 16px、描边 1.75（`size-icon`）。角标里用 12px、描边 2.25；空状态用 24px、描边 1.5。只用这三档。
- 颜色用 `currentColor`，由所在的文字颜色决定；不单独给图标上色，三组状态标记除外。
- 一个概念只对应一个图标，全产品一致：文件夹 `folder`、智能文件夹 `folder-search`、待审 `clock`、通过 `check`（带文字时 `badge-check`）、打回 `undo-2`、断链 `unlink`、上游已更新 `circle-arrow-up`、文件缺失 `file-question`、AI 产出 `sparkles`、Agent `bot`、插件 `puzzle`、对比 `git-compare-arrows`、关系 `waypoints`。
- 格式图标：图片 `image`、视频 `film`、音频 `audio-lines`、模型 `box`、文档 `file-text`、未知 `file`。
- 只有图标的按钮必须有 `aria-label`；装饰性的图标加 `aria-hidden`。
- 不用 emoji 当图标。物料阶段的圆形色标不是图标，是 CSS 画的，见状态标记。
