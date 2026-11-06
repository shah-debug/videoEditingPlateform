import { create } from 'zustand'
import type { CaptionStyle, Job, Project, Segment, Settings, Word } from '../types'
import { POSITION_Y } from '../types'
import { displayWords, mergeSegments, newId, resyncWords, retimeSegment, shiftSegment, splitSegment } from '../subtitles/wordSync'

export interface Doc {
  segments: Segment[]
  style: CaptionStyle
  settings: Settings
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

interface EditorState {
  project: Project | null
  doc: Doc | null
  past: Doc[]
  future: Doc[]
  lastKey: string | null
  lastKeyTime: number
  selectedId: string | null
  /** all selected captions (multi-select); always contains selectedId when that is set */
  selectedIds: string[]
  editingId: string | null
  styleScope: 'all' | 'selected'
  saveState: SaveState
  saveError: string | null
  dirtyVersion: number
  jobs: Record<string, Job>

  load: (p: Project) => void
  setProjectMeta: (p: Partial<Project>) => void
  replaceDocFromServer: (p: Project, recordHistory: boolean) => void
  commit: (fn: (d: Doc) => Doc, key?: string) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  /** Ctrl/Cmd+click: add or remove one caption from the selection */
  toggleSelect: (id: string) => void
  /** Shift+click: select every caption between the current one and id */
  selectRange: (id: string) => void
  selectAll: () => void
  /** delete every selected caption in one undo step */
  deleteSelected: () => void
  /** move several captions together by dt seconds (clamped so they never overlap other captions) */
  moveSegments: (ids: string[], dt: number, key?: string) => void
  setEditing: (id: string | null) => void
  setStyleScope: (s: 'all' | 'selected') => void
  setSaveState: (s: SaveState, err?: string | null) => void
  upsertJob: (j: Job) => void

  // editing ops
  setText: (id: string, text: string) => void
  setTiming: (id: string, start: number, end: number, key?: string) => void
  moveSegment: (id: string, dt: number, key?: string) => void
  addSegment: (at: number, duration: number) => string
  deleteSegment: (id: string) => void
  duplicateSegment: (id: string) => void
  split: (id: string, at: { time?: number; wordIndex?: number }) => void
  mergeWithNext: (id: string) => void
  setWordColor: (segId: string, wordIndex: number, color: string | null) => void
  setStyle: (patch: Partial<CaptionStyle>, key?: string) => void
  clearSegmentStyle: (id: string) => void
  applyPreset: (style: Partial<CaptionStyle>, presetId?: string) => void
  setSettings: (patch: Partial<Settings>, key?: string) => void
}

const HISTORY_LIMIT = 200
const COALESCE_MS = 900

/** Words of the caption currently being typed in, captured before the first keystroke. Cleared by any other edit. */
let textBase: { id: string; start: number; end: number; words: Word[] } | null = null

const sortSegs = (s: Segment[]) => [...s].sort((a, b) => a.start - b.start || a.end - b.end)

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  doc: null,
  past: [],
  future: [],
  lastKey: null,
  lastKeyTime: 0,
  selectedId: null,
  selectedIds: [],
  editingId: null,
  styleScope: 'all',
  saveState: 'saved',
  saveError: null,
  dirtyVersion: 0,
  jobs: {},

  load: (p) => { textBase = null; set({
    project: p,
    doc: { segments: sortSegs(p.segments ?? []), style: p.style, settings: p.settings },
    past: [], future: [], selectedId: null, selectedIds: [], editingId: null, saveState: 'saved', dirtyVersion: 0, lastKey: null,
  }) },
  setProjectMeta: (patch) => set((s) => ({ project: s.project ? { ...s.project, ...patch } : s.project })),
  replaceDocFromServer: (p, recordHistory) => set((s) => {
    textBase = null
    const doc: Doc = { segments: sortSegs(p.segments ?? []), style: p.style, settings: p.settings }
    return {
      project: { ...p },
      doc,
      past: recordHistory && s.doc ? [...s.past, s.doc].slice(-HISTORY_LIMIT) : s.past,
      future: [],
      selectedId: null,
      selectedIds: [],
      editingId: null,
      lastKey: null,
      saveState: 'saved',
    }
  }),

  commit: (fn, key) => {
    const s = get()
    if (!s.doc) return
    const next = fn(s.doc)
    if (next === s.doc) return
    if (!key?.startsWith('text-')) textBase = null
    const now = performance.now()
    const coalesce = !!key && key === s.lastKey && now - s.lastKeyTime < COALESCE_MS
    set({
      doc: next,
      past: coalesce ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key ?? null,
      lastKeyTime: now,
      saveState: 'unsaved',
      dirtyVersion: s.dirtyVersion + 1,
    })
  },
  undo: () => {
    const s = get()
    if (!s.past.length || !s.doc) return
    textBase = null
    const prev = s.past[s.past.length - 1]
    set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], lastKey: null, saveState: 'unsaved', dirtyVersion: s.dirtyVersion + 1 })
  },
  redo: () => {
    const s = get()
    if (!s.future.length || !s.doc) return
    textBase = null
    const nxt = s.future[0]
    set({ doc: nxt, past: [...s.past, s.doc], future: s.future.slice(1), lastKey: null, saveState: 'unsaved', dirtyVersion: s.dirtyVersion + 1 })
  },
  select: (id) => set((s) => ({ selectedId: id, selectedIds: id ? [id] : [], editingId: id === s.editingId ? s.editingId : null, styleScope: id ? s.styleScope : 'all' })),
  toggleSelect: (id) => set((s) => {
    const has = s.selectedIds.includes(id)
    const ids = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
    const primary = has ? (s.selectedId === id ? ids[ids.length - 1] ?? null : s.selectedId) : id
    return { selectedIds: ids, selectedId: primary, editingId: null, styleScope: primary ? s.styleScope : 'all' }
  }),
  selectRange: (id) => set((s) => {
    const segs = s.doc?.segments ?? []
    const a = segs.findIndex((x) => x.id === (s.selectedId ?? id)), b = segs.findIndex((x) => x.id === id)
    if (a < 0 || b < 0) return {}
    const [lo, hi] = a < b ? [a, b] : [b, a]
    return { selectedIds: segs.slice(lo, hi + 1).map((x) => x.id), selectedId: id, editingId: null }
  }),
  selectAll: () => set((s) => {
    const segs = s.doc?.segments ?? []
    if (!segs.length) return {}
    return { selectedIds: segs.map((x) => x.id), selectedId: s.selectedId && segs.some((x) => x.id === s.selectedId) ? s.selectedId : segs[0].id, editingId: null }
  }),
  deleteSelected: () => {
    const ids = new Set(get().selectedIds.length ? get().selectedIds : get().selectedId ? [get().selectedId!] : [])
    if (!ids.size) return
    get().commit((d) => ({ ...d, segments: d.segments.filter((x) => !ids.has(x.id)) }))
    set({ selectedId: null, selectedIds: [], editingId: null, styleScope: 'all' })
  },
  moveSegments: (ids, dt, key) => get().commit((d) => {
    const sel = new Set(ids)
    const segs = d.segments
    const total = useTime.getState().duration || Math.max(0, ...segs.map((x) => x.end))
    let lo = -Infinity, hi = Infinity
    segs.forEach((x, i) => {
      if (!sel.has(x.id)) return
      // nearest captions that are not moving, before and after this one
      let pi = i - 1; while (pi >= 0 && sel.has(segs[pi].id)) pi--
      let ni = i + 1; while (ni < segs.length && sel.has(segs[ni].id)) ni++
      lo = Math.max(lo, (pi >= 0 ? segs[pi].end : 0) - x.start)
      hi = Math.min(hi, (ni < segs.length ? segs[ni].start : Math.max(total, x.end)) - x.end)
    })
    const t = Math.min(Math.max(dt, lo), hi)
    if (!isFinite(t) || Math.abs(t) < 1e-6) return d
    return { ...d, segments: sortSegs(segs.map((x) => (sel.has(x.id) ? shiftSegment(x, t) : x))) }
  }, key),
  setEditing: (id) => set({ editingId: id }),
  setStyleScope: (styleScope) => set({ styleScope }),
  setSaveState: (saveState, err = null) => set({ saveState, saveError: err }),
  upsertJob: (j) => set((s) => ({ jobs: { ...s.jobs, [j.id]: { ...(s.jobs[j.id] ?? {}), ...j } } })),

  setText: (id, text) => {
    // Re-sync against the words as they were before this caption's typing started, not against the
    // half-typed intermediate state (which degrades timings keystroke by keystroke).
    const seg = get().doc?.segments.find((s) => s.id === id)
    if (!seg) return
    let base = textBase
    if (!base || base.id !== id || base.start !== seg.start || base.end !== seg.end) {
      base = { id, start: seg.start, end: seg.end, words: displayWords(seg) }
    }
    get().commit((d) => ({
      ...d,
      segments: d.segments.map((s) => (s.id === id ? { ...s, text, words: resyncWords(base!.words, text, s.start, s.end) } : s)),
    }), `text-${id}`)
    textBase = base
  },

  setTiming: (id, start, end, key) => get().commit((d) => ({
    ...d,
    segments: sortSegs(d.segments.map((s) => (s.id === id ? retimeSegment(s, Math.max(0, start), Math.max(start + 0.05, end)) : s))),
  }), key ?? `time-${id}`),

  moveSegment: (id, dt, key) => get().commit((d) => ({
    ...d, segments: sortSegs(d.segments.map((s) => (s.id === id ? shiftSegment(s, dt) : s))),
  }), key ?? `move-${id}`),

  addSegment: (at, duration) => {
    const id = newId()
    get().commit((d) => {
      // fit into the gap at `at`
      const next = d.segments.find((s) => s.start > at)
      const end = Math.min(at + duration, next ? next.start : at + duration)
      const seg: Segment = { id, start: at, end: Math.max(end, at + 0.3), text: 'New caption', words: [], style: null }
      return { ...d, segments: sortSegs([...d.segments, seg]) }
    })
    set({ selectedId: id, selectedIds: [id], editingId: id })
    return id
  },
  deleteSegment: (id) => {
    get().commit((d) => ({ ...d, segments: d.segments.filter((s) => s.id !== id) }))
    set((s) => ({ selectedIds: s.selectedIds.filter((x) => x !== id), ...(s.selectedId === id ? { selectedId: null, editingId: null } : {}) }))
  },
  duplicateSegment: (id) => {
    const nid = newId()
    get().commit((d) => {
      const s = d.segments.find((x) => x.id === id)
      if (!s) return d
      const dur = s.end - s.start
      const copy = shiftSegment({ ...s, id: nid }, dur)
      return { ...d, segments: sortSegs([...d.segments, copy]) }
    })
    set({ selectedId: nid, selectedIds: [nid] })
  },
  split: (id, at) => get().commit((d) => {
    const s = d.segments.find((x) => x.id === id)
    if (!s) return d
    const parts = splitSegment(s, at)
    if (!parts) return d
    return { ...d, segments: sortSegs(d.segments.flatMap((x) => (x.id === id ? parts : [x]))) }
  }),
  mergeWithNext: (id) => get().commit((d) => {
    const i = d.segments.findIndex((x) => x.id === id)
    if (i < 0 || i + 1 >= d.segments.length) return d
    const merged = mergeSegments(d.segments[i], d.segments[i + 1])
    const segs = [...d.segments]
    segs.splice(i, 2, merged)
    return { ...d, segments: segs }
  }),
  setWordColor: (segId, wi, color) => get().commit((d) => ({
    ...d,
    segments: d.segments.map((s) => {
      if (s.id !== segId) return s
      const words = resyncWords(s.words, s.text, s.start, s.end).map((w, i) => (i === wi ? { ...w, color } : w))
      return { ...s, words }
    }),
  })),

  setStyle: (patch, key) => {
    const s = get()
    const p: Partial<CaptionStyle> = { ...patch }
    if (p.position && p.position !== 'custom') p.y = POSITION_Y[p.position]
    if (s.styleScope === 'selected' && s.selectedId) {
      const ids = new Set(s.selectedIds.length ? s.selectedIds : [s.selectedId])
      s.commit((d) => ({
        ...d, segments: d.segments.map((x) => (ids.has(x.id) ? { ...x, style: { ...(x.style ?? {}), ...p } } : x)),
      }), key ? `${key}-${[...ids].join(',')}` : undefined)
    } else {
      s.commit((d) => ({ ...d, style: { ...d.style, ...p } }), key)
    }
  },
  clearSegmentStyle: (id) => get().commit((d) => ({ ...d, segments: d.segments.map((x) => (x.id === id ? { ...x, style: null } : x)) })),
  applyPreset: (style, presetId) => get().commit((d) => ({
    ...d, style: { ...d.style, ...style }, settings: { ...d.settings, presetId: presetId ?? null },
  })),
  setSettings: (patch, key) => get().commit((d) => ({ ...d, settings: { ...d.settings, ...patch } }), key),
}))

export function effectiveStyle(doc: Doc, seg: Segment | null | undefined): CaptionStyle {
  if (!seg?.style) return doc.style
  return { ...doc.style, ...Object.fromEntries(Object.entries(seg.style).filter(([, v]) => v !== null && v !== undefined)) }
}

/** Playback/time state kept separate so per-frame updates don't re-render the whole editor. */
interface TimeState {
  time: number
  duration: number
  playing: boolean
  set: (p: Partial<Omit<TimeState, 'set'>>) => void
}
export const useTime = create<TimeState>((set) => ({ time: 0, duration: 0, playing: false, set: (p) => set(p) }))

let videoEl: HTMLVideoElement | null = null
export const player = {
  attach: (v: HTMLVideoElement | null) => { videoEl = v },
  get el() { return videoEl },
  seek: (t: number) => {
    const d = useTime.getState().duration
    const tt = Math.max(0, Math.min(d || t, t))
    if (videoEl) videoEl.currentTime = tt
    useTime.getState().set({ time: tt })
  },
  toggle: () => {
    if (!videoEl) return
    if (videoEl.paused) videoEl.play().catch(() => undefined)
    else videoEl.pause()
  },
  pause: () => videoEl?.pause(),
}
