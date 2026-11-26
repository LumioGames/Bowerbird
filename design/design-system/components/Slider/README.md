滑杆在一个连续范围里取值，拖动过程中结果实时跟着变。

**你提供**：`min`、`max`、`value` 和 `aria-label`。它是原生的 `input[type=range]`，所以跟手是 1:1 的，方向键也能用；`Bowerbird.slider(el, onInput)` 只负责把已填充段画出来。

- 用在顶栏的缩略图大小（`size-cell-min` 到 `size-cell-max`，默认 `size-cell`）、叠加对比的透明度、查看器的曝光。
- 拖动时网格必须同步变化，不要等松手。
- 需要精确数值的地方（面数范围、时间）用输入框，不用滑杆。
- 已填充段是少数允许出现 `accent-fill` 的地方之一。
