/**
 * Caption layout engine — line-for-line port of backend/app/services/caption_layout.py.
 * Both produce the same lines and boxes for the same style/frame, which keeps preview == export.
 * Change both files together.
 */
import type { CaptionStyle, FontInfo, Word } from '../types'
import { measureText } from '../services/fonts'

export const STYLE_REFERENCE = 1080

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
export const isRtl = (t: string) => ARABIC_RE.test(t || '')

export function applyCase(text: string, mode: CaptionStyle['textCase']) {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  if (mode === 'title') return text.split(' ').map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(' ')
  return text
}

export interface LayoutLine { wordIndices: number[]; text: string; width: number; cx: number; cy: number; baseline: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Layout {
  scale: number
  fontPx: number
  lineHeight: number
  lines: LayoutLine[]
  boxes: Rect[]
  radius: number
  centerX: number
  centerY: number
  rtl: boolean
  ascent: number
  descent: number
}

export function layoutCaption(wordsIn: string[], style: CaptionStyle, frameW: number, frameH: number, font: FontInfo | undefined): Layout {
  const fid = style.fontFamily
  const scale = Math.min(frameW, frameH) / STYLE_REFERENCE
  const weight = style.fontWeight
  const italic = style.italic
  const words = wordsIn.map((w) => applyCase(w, style.textCase))
  const rtl = isRtl(words.join(' '))
  const maxW = Math.max(10, style.maxWidth * frameW)
  const bg = style.backgroundEnabled
  const padX = bg ? style.backgroundPaddingX * scale : 0
  const padY = bg ? style.backgroundPaddingY * scale : 0
  const basePx = style.fontSize * scale
  const maxLines = Math.max(1, Math.floor(style.maxLines))
  const wrap = style.wrap

  const wrapLines = (px: number) => {
    const ls = style.letterSpacing * scale
    const meas = (t: string) => measureText(fid, t, px, weight, italic, ls)
    const out: [number[], string, number][] = []
    let curIdx: number[] = []
    let cur = ''
    words.forEach((w, i) => {
      if (!w) return
      if (!cur) { cur = w; curIdx = [i]; return }
      const cand = `${cur} ${w}`
      if (!wrap || meas(cand) <= maxW) { cur = cand; curIdx = [...curIdx, i] }
      else { out.push([curIdx, cur, meas(cur)]); cur = w; curIdx = [i] }
    })
    if (cur) out.push([curIdx, cur, meas(cur)])
    return out
  }

  let px = basePx
  let lines = wrapLines(px)
  let tries = 0
  while (lines.length > maxLines && tries < 12) {
    px *= 0.92
    lines = wrapLines(px)
    tries++
  }

  const lh = style.lineHeight * px
  const n = Math.max(1, lines.length)
  const blockW = lines.reduce((m, l) => Math.max(m, l[2]), 0)
  const blockH = n * lh
  const bgWFrac = style.backgroundWidth || 0
  const totalW = bg && bgWFrac > 0 ? bgWFrac * frameW : blockW + 2 * padX
  const totalH = Math.max(blockH + 2 * padY, bg ? style.backgroundMinHeight * scale : 0)

  let cx = style.x * frameW
  let cy = style.y * frameH
  cx = totalW < frameW ? Math.min(Math.max(cx, totalW / 2), frameW - totalW / 2) : frameW / 2
  cy = totalH < frameH ? Math.min(Math.max(cy, totalH / 2), frameH - totalH / 2) : frameH / 2

  const asc = font ? font.ascent * px : 0.9 * px
  const desc = font ? font.descent * px : 0.25 * px
  const align = style.align
  const boxLeft = cx - totalW / 2
  const top = cy - blockH / 2

  const out: Layout = {
    scale, fontPx: px, lineHeight: lh, lines: [], boxes: [], radius: style.backgroundRadius * scale,
    centerX: cx, centerY: cy, rtl, ascent: asc, descent: desc,
  }
  lines.forEach(([idx, text, width], i) => {
    const lcy = top + (i + 0.5) * lh
    const ax = align === 'left' ? boxLeft + padX : align === 'right' ? boxLeft + totalW - padX : cx
    out.lines.push({ wordIndices: idx, text, width, cx: ax, cy: lcy, baseline: lcy + (asc - desc) / 2 })
  })

  if (bg && lines.length) {
    if (style.backgroundMode === 'line') {
      for (const ln of out.lines) {
        const lx = align === 'left' ? ln.cx - padX : align === 'right' ? ln.cx - ln.width - padX : ln.cx - ln.width / 2 - padX
        out.boxes.push({ x: lx, y: ln.cy - lh / 2 - padY, w: ln.width + 2 * padX, h: lh + 2 * padY })
      }
    } else {
      out.boxes.push({ x: boxLeft, y: cy - totalH / 2, w: totalW, h: totalH })
    }
  }
  return out
}

/** Same geometry as rounded_rect_path() in Python (cubic bezier corners). */
export function roundedRectPath(r: Rect, radius: number) {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h
  if (rad < 0.5) return `M${x0} ${y0}L${x1} ${y0}L${x1} ${y1}L${x0} ${y1}Z`
  const k = rad * 0.5523
  return [
    `M${x0 + rad} ${y0}`, `L${x1 - rad} ${y0}`, `C${x1 - rad + k} ${y0} ${x1} ${y0 + rad - k} ${x1} ${y0 + rad}`,
    `L${x1} ${y1 - rad}`, `C${x1} ${y1 - rad + k} ${x1 - rad + k} ${y1} ${x1 - rad} ${y1}`,
    `L${x0 + rad} ${y1}`, `C${x0 + rad - k} ${y1} ${x0} ${y1 - rad + k} ${x0} ${y1 - rad}`,
    `L${x0} ${y0 + rad}`, `C${x0} ${y0 + rad - k} ${x0 + rad - k} ${y0} ${x0 + rad} ${y0}`, 'Z',
  ].join('')
}

export const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 }

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)

/** Same as output_size() in ffmpeg_renderer.py */
export function outputSize(srcW: number, srcH: number, aspect: string, resolution = 'original'): [number, number] {
  const ar = aspect === 'original' || !aspect ? srcW / srcH : ASPECTS[aspect] ?? srcW / srcH
  const short = resolution === '720p' ? 720 : resolution === '1080p' ? 1080 : resolution === '4k' ? 2160 : Math.min(srcW, srcH)
  return ar >= 1 ? [even(short * ar), even(short)] : [even(short), even(short / ar)]
}

/** Word "active window": from its start until the next word starts (same as word_active_windows()). */
export function activeWindows(words: Word[], segEnd: number): [number, number][] {
  return words.map((w, i) => {
    const nxt = i + 1 < words.length ? words[i + 1].start : segEnd
    return [w.start, Math.max(w.start, Math.min(nxt, segEnd))]
  })
}
