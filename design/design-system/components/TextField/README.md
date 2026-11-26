输入框接收一段文字；搜索框是它的一种，能把条件语法收成可删除的片段。

**你提供**：`<input>` 或 `<textarea>`（类 `bb-field__input`）放进 `bb-field`；可选的前置图标、尾部快捷键帽；上方 `bb-label`，下方 `bb-hint`。

- 默认高度 `size-control`；对话框里用 `bb-field--lg`；多行用 `bb-field--area`。
- 校验即时进行，不等提交：出错时给容器加 `data-invalid`，并在 `bb-hint[data-level="error"]` 里说明怎么改。
- **搜索框**：使用者输入 `stage:runtime` 这类条件后按空格，条件变成一个 `bb-cond` 片段，键用 `ink-2`、值用 `ink-1`，等宽字体。片段与筛选面板里的勾选是同一份条件的两种表现，任何一边改动另一边立刻跟着变。排除条件保留前面的减号。
- 占位符说明能输入什么，不重复标签。
- 只读但需要展示的值（路径、GUID）不要做成禁用的输入框，用检查器里的 `bb-copy`。
