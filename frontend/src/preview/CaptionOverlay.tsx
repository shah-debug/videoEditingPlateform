import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionStyle, FontInfo, Segment, Word } from '../types'
import { effectiveStyle, useEditor, useTime } from '../editor/store'
import { browserMetrics, cssFamily, useFonts } from '../services/fonts'
import { activeWindows, applyCase, layoutCaption, roundedRectPath, type Layout } from './captionLayout'
import { displayWords } from '../subtitles/wordSync'

interface Props {
  frameW: number // export-space frame size (layout units = export pixels)
  frameH: number
  displayScale: number // export px -> screen px
  interactive?: boolean
}

interface Prepared { seg: Segment; style: CaptionStyle; words: Word[]; layout: Layout; font?: FontInfo }

const cache = new Map<string, { seg: Segment; style: CaptionStyle; key: string; p: Prepared }>()

function prepare(seg: Segment, style: CaptionStyle, W: number, H: number, fonts: Record<string, FontInfo>, ver: number): Prepared {
  const key = `${W}x${H}|${ver}`
  const c = cache.get(seg.id)
  if (c && c.seg === seg && c.style === style && c.key === key) return c.p
  const words = displayWords(seg)
  const font = fonts[style.fontFamily]
  const layout = layoutCaption(words.map((w) => w.text), style, W, H, font)
  const p = { seg, style, words, layout, font }
  cache.set(seg.id, { seg, style, key, p })
  if (cache.size > 3000) cache.clear()
  return p
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function CaptionOverlay({ frameW, frameH, displayScale, interactive = true }: Props) {
  const doc = useEditor((s) => s.doc)
  const selectedId = useEditor((s) => s.selectedId)
  const time = useTime((s) => s.time)
  const { fonts, version, ensure } = useFonts()
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const drag = useRef<{ id: string; x0: number; y0: number; sx: number; sy: number } | null>(null)

  // load every font used by the document
  const usedFonts = useMemo(() => {
    if (!doc) return [] as string[]
    const s = new Set<string>([doc.style.fontFamily])
    doc.segments.forEach((g) => g.style?.fontFamily && s.add(g.style.fontFamily))
    return [...s]
  }, [doc])
  useEffect(() => { usedFonts.forEach((f) => ensure(f)) }, [usedFonts, ensure, fonts])

  if (!doc) return null
  const active = doc.segments.filter((s) => time >= s.start && time < s.end)
  // keep the selected caption visible while paused for editing even if playhead is outside it
  const sel = selectedId ? doc.segments.find((s) => s.id === selectedId) : null
  const showSel = sel && !active.includes(sel) && !useTime.getState().playing && useEditor.getState().editingId === sel.id
  const list = showSel ? [...active, sel] : active

  const onPointerDown = (e: React.PointerEvent, p: Prepared) => {
    if (!interactive) return
    e.preventDefault()
    e.stopPropagation()
    useEditor.getState().select(p.seg.id)
    const st = useEditor.getState()
    const style = st.styleScope === 'selected' ? effectiveStyle(st.doc!, p.seg) : st.doc!.style
    drag.current = { id: p.seg.id, x0: e.clientX, y0: e.clientY, sx: style.x, sy: style.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let x = d.sx + (e.clientX - d.x0) / (displayScale * frameW)
    let y = d.sy + (e.clientY - d.y0) / (displayScale * frameH)
    const snapV = Math.abs(x - 0.5) < 0.012
    const snapH = Math.abs(y - 0.5) < 0.012
    if (snapV) x = 0.5
    if (snapH) y = 0.5
    setGuides({ v: snapV, h: snapH })
    useEditor.getState().setStyle({ x: clamp01(x), y: clamp01(y), position: 'custom' }, 'drag')
  }
  const onPointerUp = () => { drag.current = null; setGuides({ v: false, h: false }) }

  return (
    <div className="absolute left-0 top-0 origin-top-left pointer-events-none"
      style={{ width: frameW, height: frameH, transform: `scale(${displayScale})` }}>
      {guides.v && <div className="absolute top-0 bottom-0 border-l border-dashed border-fuchsia-400" style={{ left: frameW / 2, borderLeftWidth: 1 / displayScale }} />}
      {guides.h && <div className="absolute left-0 right-0 border-t border-dashed border-fuchsia-400" style={{ top: frameH / 2, borderTopWidth: 1 / displayScale }} />}
      {list.map((seg) => {
        const style = effectiveStyle(doc, seg)
        const p = prepare(seg, style, frameW, frameH, fonts, version)
        return (
          <CaptionView key={seg.id} p={p} time={time} frameH={frameH} selected={seg.id === selectedId} displayScale={displayScale}
            interactive={interactive} onPointerDown={(e) => onPointerDown(e, p)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        )
      })}
    </div>
  )
}

function CaptionView({ p, time, frameH, selected, displayScale, interactive, onPointerDown, onPointerMove, onPointerUp }: {
  p: Prepared; time: number; frameH: number; selected: boolean; displayScale: number; interactive: boolean
  onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void
}) {
  const { seg, style, words, layout } = p
  const px = layout.fontPx
  const bm = browserMetrics(style.fontFamily, style.fontWeight, style.italic)
  const A = bm.ascent * px, D = bm.descent * px

  // animation state (same formulas as the ASS tags in subtitle_formats.py)
  const dur = seg.end - seg.start
  const ad = Math.min(style.animationDuration, dur / 2)
  const pin = ad > 0 ? clamp01((time - seg.start) / ad) : 1
  const pout = ad > 0 ? clamp01((seg.end - time) / ad) : 1
  let opacity = 1
  if (style.animationIn === 'fade') opacity *= pin
  if (style.animationOut === 'fade') opacity *= pout
  const scale = style.animationIn === 'pop' ? 0.7 + 0.3 * pin : 1
  const slide = style.animationIn === 'slide-up' ? 0.06 * frameH * (1 - pin) : style.animationIn === 'slide-down' ? -0.06 * frameH * (1 - pin) : 0

  const windows = activeWindows(words, seg.end)
  const mode = style.wordMode
  const outline = style.outlineEnabled ? style.outlineWidth * layout.scale : 0
  const tx = style.align === 'left' ? '0%' : style.align === 'right' ? '-100%' : '-50%'
  const origin = style.align === 'left' ? '0% 50%' : style.align === 'right' ? '100% 50%' : '50% 50%'

  const wordColor = (i: number) => {
    const base = words[i].color || style.textColor
    const [a, b] = windows[i]
    if ((mode === 'highlight' || mode === 'reveal-highlight') && time >= a && time < b) return style.activeWordColor
    if (mode === 'karaoke' && time >= a) return style.activeWordColor
    return base
  }
  const wordVisible = (i: number) => !(mode === 'reveal' || mode === 'reveal-highlight') || time >= windows[i][0]

  const lineStyle = (cx: number, baseline: number): React.CSSProperties => ({
    left: cx,
    top: baseline - A + slide,
    fontFamily: `"${cssFamily(style.fontFamily)}", sans-serif`,
    fontSize: px,
    fontWeight: style.fontWeight >= 600 ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    letterSpacing: style.letterSpacing * layout.scale,
    lineHeight: `${A + D}px`,
    height: A + D,
    direction: layout.rtl ? 'rtl' : 'ltr',
    transform: `translateX(${tx}) scale(${scale})`,
    transformOrigin: origin,
  })

  // selection / drag handle bounds
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const ln of layout.lines) {
      const l = style.align === 'left' ? ln.cx : style.align === 'right' ? ln.cx - ln.width : ln.cx - ln.width / 2
      x0 = Math.min(x0, l); x1 = Math.max(x1, l + ln.width)
      y0 = Math.min(y0, ln.cy - layout.lineHeight / 2); y1 = Math.max(y1, ln.cy + layout.lineHeight / 2)
    }
    for (const b of layout.boxes) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.h) }
    return { x0, x1, y0, y1 }
  }, [layout, style.align])

  return (
    <div style={{ opacity }}>
      {style.backgroundEnabled && layout.boxes.length > 0 && (
        <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {layout.boxes.map((b, i) => (
            <path key={i} d={roundedRectPath(b, layout.radius)} fill={style.backgroundColor} fillOpacity={style.backgroundOpacity}
              transform={`translate(0 ${slide}) translate(${b.x + b.w / 2} ${b.y + b.h / 2}) scale(${scale}) translate(${-(b.x + b.w / 2)} ${-(b.y + b.h / 2)})`} />
          ))}
        </svg>
      )}
      {style.shadowEnabled && layout.lines.map((ln, li) => (
        <div key={`s${li}`} className="caption-line" style={{
          ...lineStyle(ln.cx + style.shadowOffsetX * layout.scale, ln.baseline + style.shadowOffsetY * layout.scale),
          color: style.shadowColor,
          WebkitTextStroke: outline ? `${outline * 2}px ${style.shadowColor}` : undefined,
          opacity: style.shadowOpacity * style.textOpacity,
          filter: style.shadowBlur ? `blur(${(style.shadowBlur * layout.scale) / 2}px)` : undefined,
        }}>
          {ln.wordIndices.map((wi, k) => (
            <span key={wi} style={{ visibility: wordVisible(wi) ? 'visible' : 'hidden' }}>
              {applyCase(words[wi].text, style.textCase)}{k < ln.wordIndices.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
      ))}
      {layout.lines.map((ln, li) => (
        <div key={li} className="caption-line" style={{
          ...lineStyle(ln.cx, ln.baseline),
          WebkitTextStroke: outline ? `${outline * 2}px ${style.outlineColor}` : undefined,
          opacity: style.textOpacity,
        }}>
          {ln.wordIndices.map((wi, k) => (
            <span key={wi} style={{ color: wordColor(wi), visibility: wordVisible(wi) ? 'visible' : 'hidden' }}>
              {applyCase(words[wi].text, style.textCase)}{k < ln.wordIndices.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
      ))}
      {interactive && isFinite(bounds.x0) && (
        <div
          className={`absolute pointer-events-auto cursor-move rounded ${selected ? 'outline-dashed outline-accent-400' : 'hover:outline-dashed hover:outline-white/40'}`}
          style={{ left: bounds.x0 - 8, top: bounds.y0 - 6 + slide, width: bounds.x1 - bounds.x0 + 16, height: bounds.y1 - bounds.y0 + 12, outlineWidth: 2 / displayScale }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onDoubleClick={() => useEditor.getState().setEditing(seg.id)}
          title="Drag to reposition · double-click to edit text"
        />
      )}
    </div>
  )
}
