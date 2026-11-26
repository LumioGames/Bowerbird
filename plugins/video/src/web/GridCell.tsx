/**
 * Grid cell for videos: the thumbnail; while the pointer is over the cell, the `scrub` frame under its
 * horizontal position, silently (builtin-plugins.md「网格悬停」), with a thin progress line.
 */
import * as React from 'react'
import type { GridCellProps } from '@bowerbird/plugin-sdk/web'
import { spriteIndex } from './lib/time.js'
import { SpriteTile, useScrubSprite } from './sprite.js'

export function VideoGridCell({ asset, hover, thumbnail }: GridCellProps) {
  // Load the sprite on first hover only.
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => { if (hover.active) setArmed(true) }, [hover.active])
  const sprite = useScrubSprite(asset, asset.id, armed)
  const scrubbing = hover.active && !!sprite
  return (
    <div className="relative size-full">
      {thumbnail ? <img src={thumbnail} alt="" draggable={false} className="block size-full object-contain" style={{ visibility: scrubbing ? 'hidden' : undefined }} /> : null}
      {scrubbing ? <SpriteTile sprite={sprite!} index={spriteIndex(hover.x)} className="absolute inset-0 block size-full object-contain" /> : null}
      {hover.active ? <i className="pointer-events-none absolute bottom-0 left-0 z-[2] h-0.5 bg-ink-1" style={{ width: `${Math.round(hover.x * 1000) / 10}%` }} /> : null}
    </div>
  )
}
