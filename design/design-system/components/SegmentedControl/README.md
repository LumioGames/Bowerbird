分段控件在两到四个互斥的视图或模式之间切换，切换立即生效。

**你提供**：选项（文字，或带 `aria-label` 的图标）与当前值。容器用 `role="radiogroup"`，每项 `role="radio"` 加 `aria-checked`；`Bowerbird.segmented(el, onChange)` 负责滑块定位与方向键。

- 用在顶栏的布局切换（瀑布流、等高网格、列表）与对比模式（并排、卷帘、叠加）。
- 只有图标时每项必须有 `aria-label` 和 `title`。
- 某个模式当前格式不支持时，把那一项设为 `disabled` 并在提示里说明，不要移除，位置要稳定。
- 超过四项、或选项是「值」而不是「视图」时，改用下拉菜单。
- 滑块走 `spring-settle` + `duration-snappy`，不回弹。
