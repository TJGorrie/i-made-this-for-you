// Animated GIFs for the README, recorded from Playwright screenshots (headless Chromium can't record GIFs itself).
// Only the pixels that changed since the previous frame are stored, so a mostly still UI stays small.
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'
// @ts-expect-error gifenc ships no types
import gifenc from 'gifenc' // CommonJS: no named imports

const { GIFEncoder, applyPalette, quantize } = gifenc

// 8-bit RGB/RGBA PNG (what Chromium screenshots are) → RGBA pixels.
export function decodePng(buf: Buffer) {
  let width = 0, height = 0, bpp = 0
  const idat: Buffer[] = []
  for (let pos = 8; pos < buf.length;) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bpp = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0
      if (data[8] !== 8 || !bpp || data[12]) throw new Error('Only 8-bit, non-interlaced RGB/RGBA PNGs')
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1), filter = raw[at]
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
      let v = raw[at + 1 + i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255
    }
    prev.set(line)
  }
  return { width, height, data: out }
}

type Clip = { x: number; y: number; width: number; height: number }

// Screenshots as fast as the browser gives them, until the returned function saves them as a GIF.
export function record(page: Page, clip: Clip) {
  const frames: { t: number; png: Buffer }[] = []
  let on = true
  const loop = (async () => { while (on) frames.push({ t: Date.now(), png: await page.screenshot({ clip }) }) })()
  return async (file: string, holdMs = 2000) => {
    on = false
    await loop
    const pixels = (i: number) => decodePng(frames[i].png).data
    // One palette for the whole GIF, from the start, middle and end; the last slot means "unchanged".
    const sample = [0, frames.length >> 1, frames.length - 1].map(pixels)
    const all = new Uint8Array(sample.reduce((n, s) => n + s.length, 0))
    sample.reduce((at, s) => (all.set(s, at), at + s.length), 0)
    const palette: number[][] = quantize(all, 255)
    palette.push([255, 0, 255])
    const SAME = palette.length - 1

    const out: { index: Uint8Array; delay: number }[] = []
    let last: Uint8Array | undefined
    for (let i = 0; i < frames.length; i++) {
      const index: Uint8Array = applyPalette(pixels(i), palette)
      const delay = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : holdMs
      if (!last) { out.push({ index, delay }); last = index; continue }
      const diff = new Uint8Array(index.length)
      let changed = false
      for (let p = 0; p < index.length; p++) {
        if (index[p] === last[p]) diff[p] = SAME
        else { diff[p] = index[p]; changed = true }
      }
      if (changed) out.push({ index: diff, delay })
      else out[out.length - 1].delay += delay // nothing moved: show the previous frame longer
      last = index
    }
    const gif = GIFEncoder()
    out.forEach(({ index, delay }, i) =>
      gif.writeFrame(index, clip.width, clip.height, {
        palette: i ? undefined : palette, delay, dispose: 1, ...(i ? { transparent: true, transparentIndex: SAME } : {}),
      }))
    gif.finish()
    fs.writeFileSync(file, gif.bytes())
    return { frames: out.length, bytes: fs.statSync(file).size }
  }
}

// A visible mouse pointer (headless screenshots have none), with a ring on each click.
export const fakeCursor = () => addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div')
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l6.5 19 2.8-7.7L20 10.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-99px,-99px)' })
  document.body.append(c)
  addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)` }, true)
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div')
    Object.assign(r.style, { position: 'fixed', left: `${e.clientX - 14}px`, top: `${e.clientY - 14}px`, width: '28px', height: '28px',
      borderRadius: '50%', border: '3px solid #e8a33d', zIndex: '2147483646', pointerEvents: 'none' })
    document.body.append(r)
    r.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 450 }).onfinish = () => r.remove()
  }, true)
})
