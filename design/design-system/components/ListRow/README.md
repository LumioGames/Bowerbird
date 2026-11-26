列表行是一条可选中的对象：左栏的视图与文件夹、检查器里的一条关系、对话框里的一个受影响资产。

**你提供**：`Bowerbird.html.row({ icon | thumb, label, sub, count, depth, toggle, expanded, selected, trailing })`。

- 高度 `size-control`；带缩略图的 `bb-row--media` 高 40px，第二行写这条关系的来历（方式、执行者、时间）。
- 树形每一级缩进 `space-4`；有子项的行左侧是可旋转的箭头，没有的留同样宽度的空位，名字才对得齐。
- 当前所在的视图或文件夹用 `aria-selected="true"`：`accent-soft` 底，图标变 `accent-ink`。一栏里同时只有一行是选中的。
- 悬停只加 `fill-rest`；数量用 `ink-3`，行被选中或按下时升到 `ink-2`。
- 拖动资产经过文件夹时给那一行加 `data-drop`：整行出现 `accent-ring` 描边，停留 600ms 自动展开。
- 行尾可以放状态（`trailing`）：顺序固定为 问题 → 阶段 → 校验，与缩略图上的含义一致。
- 文件夹显示真实目录名，中文别名跟在后面用 `ink-3`。
