/**
 * Grid cell for images: the thumbnail; animated images play their small animated copy (stored as the `scrub`
 * variant) while the pointer is over the cell (builtin-plugins.md「动图取第一帧，另存一份缩小的动图供悬停播放」).
 */
import * as React from 'react'
import { ShellContext, type GridCellProps } from '@bowerbird/plugin-sdk/web'

/** Formats that may be animated; other images never request the hover copy. */
const MAY_ANIMATE = /\.(gif|webp|avif)$/i
/** Assets known to have no animated copy (404 once per page). */
const noHover = new Set<string>()

export function ImageGridCell({ asset, hover, thumbnail }: GridCellProps) {
  const shell = React.useContext(ShellContext)
  const [ready, setReady] = React.useState(false)
  const key = `${asset.id}|${thumbnail ?? ''}`
  const want = hover.active && !!shell && MAY_ANIMATE.test(asset.name) && !noHover.has(key)
  const hoverUrl = want ? shell!.api.assets.thumbnailUrl(shell!.library.id, asset.id, 'scrub') + (thumbnail ? `&k=${encodeURIComponent(thumbnail)}` : '') : null
  React.useEffect(() => { if (!hover.active) setReady(false) }, [hover.active])
  return (
    <div className="relative size-full">
      {thumbnail ? <img src={thumbnail} alt="" draggable={false} className="block size-full object-contain" style={{ visibility: ready && want ? 'hidden' : undefined }} /> : null}
      {hoverUrl ? (
        <img
          src={hoverUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 block size-full object-contain"
          style={{ visibility: ready ? undefined : 'hidden' }}
          onLoad={() => setReady(true)}
          onError={() => { noHover.add(key); setReady(false) }}
        />
      ) : null}
    </div>
  )
}
