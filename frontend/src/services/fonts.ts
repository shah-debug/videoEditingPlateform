import { create } from 'zustand'
import type { FontInfo } from '../types'
import { api } from './api'

/** Fonts are loaded from the backend (the same files libass uses for export) under private CSS names. */
export const cssFamily = (id: string) => `cf-${id}`

interface FontState {
  fonts: Record<string, FontInfo>
  list: FontInfo[]
  loaded: Record<string, boolean>
  version: number
  init: () => Promise<void>
  ensure: (id: string) => Promise<void>
}

const pending: Record<string, Promise<void>> = {}

export const useFonts = create<FontState>((set, get) => ({
  fonts: {},
  list: [],
  loaded: {},
  version: 0,
  init: async () => {
    const list = await api.fonts()
    const fonts: Record<string, FontInfo> = {}
    list.forEach((f) => (fonts[f.id] = f))
    set({ fonts, list })
  },
  ensure: (id: string) => {
    const f = get().fonts[id]
    if (!f || get().loaded[id]) return Promise.resolve()
    if (id in pending) return pending[id]
    pending[id] = (async () => {
      const faces = f.variants.map((v) => {
        const weight = v.startsWith('700') ? '700' : '400'
        const style = v.endsWith('i') ? 'italic' : 'normal'
        return new FontFace(cssFamily(id), `url(/api/fonts/file/${encodeURIComponent(id)}/${v})`, { weight, style })
      })
      await Promise.all(faces.map(async (face) => {
        try {
          await face.load()
          document.fonts.add(face)
        } catch (e) {
          console.warn('font failed', id, e)
        }
      }))
      set((s) => ({ loaded: { ...s.loaded, [id]: true }, version: s.version + 1 }))
    })()
    return pending[id]
  },
}))

let ctx: CanvasRenderingContext2D | null = null
const measureCache = new Map<string, number>()

export function fontString(id: string, px: number, weight: number, italic: boolean) {
  // canvas needs the synthetic bold/italic choice to match the DOM's
  return `${italic ? 'italic ' : ''}${weight >= 600 ? 700 : 400} ${px}px "${cssFamily(id)}", sans-serif`
}

/** Advance width as measured by the browser shaper, plus letter spacing per char (same rule as the backend). */
export function measureText(id: string, text: string, px: number, weight: number, italic: boolean, letterSpacingPx: number) {
  if (!text) return 0
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  const key = `${id}|${weight >= 600 ? 7 : 4}|${italic ? 1 : 0}|${text}`
  let unit = measureCache.get(key)
  if (unit === undefined) {
    ctx!.font = fontString(id, 100, weight, italic)
    unit = ctx!.measureText(text).width / 100
    if (measureCache.size > 20000) measureCache.clear()
    measureCache.set(key, unit)
  }
  return unit * px + letterSpacingPx * text.length
}

/** Browser's own ascent/descent (used to place the DOM baseline exactly where libass puts it). */
export function browserMetrics(id: string, weight: number, italic: boolean) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  ctx!.font = fontString(id, 100, weight, italic)
  const m = ctx!.measureText('Hg')
  return { ascent: m.fontBoundingBoxAscent / 100, descent: m.fontBoundingBoxDescent / 100 }
}

export function clearMeasureCache() {
  measureCache.clear()
}
