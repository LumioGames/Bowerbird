/**
 * Grid cell for documents: no image thumbnail; the title and the opening lines (pipeline-and-cache.md
 * 「文档类资产不生成图片缩略图」, design-system `.bb-cell__doc`).
 */
import type { GridCellProps } from '@bowerbird/plugin-sdk/web'

export function DocGridCell({ asset, size }: GridCellProps) {
  const title = asset.cellText?.title || asset.name
  const excerpt = asset.cellText?.excerpt ?? ''
  const big = size >= 360
  return (
    <div className="size-full overflow-hidden px-3 pt-3 text-left [mask-image:linear-gradient(#000_60%,transparent)]">
      <b className={big ? 'block pt-8 text-[20px] font-semibold leading-[26px] text-ink-1' : 'block pt-5 text-[13px] font-semibold leading-[18px] text-ink-1'}>{title}</b>
      {excerpt ? <p className={big ? 'mt-2 text-[13px] leading-5 text-ink-2' : 'mt-1 text-[11px] leading-[15px] text-ink-2'}>{excerpt}</p> : null}
    </div>
  )
}
