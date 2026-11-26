/**
 * The `scrub` sprite (25 frames, 5 × 5) loaded once per asset and drawn tile by tile: the grid hover and the
 * viewer's timeline strip both read it.
 */
import * as React from 'react'
import type { AssetDetail, AssetSummary } from '@bowerbird/schema'
import { ShellContext } from '@bowerbird/plugin-sdk/web'
import { SCRUB_COLS, SCRUB_ROWS, spriteTile } from './lib/time.js'

export interface Sprite { img: HTMLImageElement; tw: number; th: number }

const cache = new Map<string, Promise<Sprite | null>>()

export function loadSprite(url: string): Promise<Sprite | null> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve({ img, tw: img.naturalWidth / SCRUB_COLS, th: img.naturalHeight / SCRUB_ROWS })
      img.onerror = () => resolve(null)
      img.src = url
    })
    cache.set(url, p)
  }
  return p
}

/** The asset's sprite, or null while loading / when there is none yet. `id` null = do not load. */
export function useScrubSprite(asset: Pick<AssetSummary | AssetDetail, 'id' | 'thumbnail'>, id: string | null, enabled = true): Sprite | null {
  const shell = React.useContext(ShellContext)
  const [sprite, setSprite] = React.useState<Sprite | null>(null)
  const url = shell && id && enabled ? shell.api.assets.thumbnailUrl(shell.library.id, id, 'scrub') + (asset.thumbnail ? `&k=${encodeURIComponent(asset.thumbnail)}` : '') : null
  React.useEffect(() => {
    if (!url) return
    let gone = false
    loadSprite(url).then(s => { if (!gone) setSprite(s) })
    return () => { gone = true }
  }, [url])
  return url ? sprite : null
}

/** One frame of the sprite on a canvas (canvas keeps the frame's aspect, so `object-fit` works). */
export function SpriteTile({ sprite, index, className }: { sprite: Sprite; index: number; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const r = spriteTile(index, sprite.tw, sprite.th)
    c.width = Math.round(r.w); c.height = Math.round(r.h)
    c.getContext('2d')?.drawImage(sprite.img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
  }, [sprite, index])
  return <canvas ref={ref} className={className} />
}
