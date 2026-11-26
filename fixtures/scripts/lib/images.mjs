// Raster images drawn from the prototype's SVG drawings with sharp (librsvg). Palette PNGs keep files small;
// sharp writes no timestamps, so output is byte-identical across runs on the same machine.
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(2)

const PNG_OPTS = { compressionLevel: 9, effort: 10, adaptiveFiltering: true }

/** Rasterise an SVG at its own width/height. */
export async function svgToRaw(svg, { alpha = false, background = '#ffffff' } = {}) {
  let img = sharp(Buffer.from(svg), { limitInputPixels: false })
  if (!alpha) img = img.flatten({ background })
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  return { data, info }
}

/** SVG → PNG. `palette` quantises to ≤256 colours without dithering (flat drawings stay exact, files stay small). */
export async function svgToPng(svg, { alpha = false, palette = true, background = '#ffffff' } = {}) {
  let img = sharp(Buffer.from(svg), { limitInputPixels: false })
  if (!alpha) img = img.flatten({ background })
  return img.png(palette ? { ...PNG_OPTS, palette: true, colours: 256, dither: 0 } : PNG_OPTS).toBuffer()
}

/**
 * A very large PNG (e.g. 16384×9216): render the drawing small, then scale up with nearest-neighbour so the
 * file stays simple and small and librsvg never allocates the full surface.
 */
export async function svgToLargePng(svg, w, h, factor) {
  const small = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).png().toBuffer()
  return sharp(small, { limitInputPixels: false })
    .resize(w, h, { kernel: 'nearest', fit: 'fill' })
    .png({ ...PNG_OPTS, palette: true, colours: 64, dither: 0 })
    .toBuffer()
    .then(b => { if (factor <= 0) throw new Error('factor'); return b })
}

export async function svgToJpeg(svg, quality = 82) {
  return sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
}

/** Animated GIF from SVG frames (all the same size). */
export async function svgFramesToGif(frames, { delayMs, alpha = true }) {
  const bufs = await Promise.all(frames.map(svg => sharp(Buffer.from(svg)).png().toBuffer()))
  return sharp(bufs, { join: { animated: true } })
    .gif({ loop: 0, delay: frames.map(() => delayMs), effort: 10, dither: 0, interFrameMaxError: 0, ...(alpha ? {} : {}) })
    .toBuffer()
}

/** Raw RGB24 frame (for piping to ffmpeg). */
export async function svgToRgb(svg) {
  const { data } = await sharp(Buffer.from(svg)).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return data
}

export async function pngInfo(buf) {
  const m = await sharp(buf).metadata()
  return { width: m.width, height: m.height, pages: m.pages ?? 1, hasAlpha: !!m.hasAlpha, format: m.format }
}
