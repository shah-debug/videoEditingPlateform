import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Merge, Minus, Plus, Scissors, Trash2, Type, AudioLines, Maximize2, MessageSquarePlus } from 'lucide-react'
import { player, useEditor, useTime } from '../editor/store'
import { formatTime } from '../services/api'
import { cx } from '../components/ui'
import type { Segment } from '../types'

const ROW = { ruler: 26, audio: 56, subs: 52 }
const LABEL_W = 96
const MIN_PPS = 4
const MAX_PPS = 600

interface Waveform { peaksPerSecond: number; peaks: number[] }

export function Timeline() {
  const project = useEditor((s) => s.project)
  const segments = useEditor((s) => s.doc?.segments ?? [])
  const selectedId = useEditor((s) => s.selectedId)
  const duration = useTime((s) => s.duration) || project?.video?.meta?.duration || 0
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 800 })
  const [pps, setPps] = useState(40)
  const [fitted, setFitted] = useState(false)
  const [wave, setWave] = useState<Waveform | null>(null)
  const video = project?.video

  useEffect(() => {
    setWave(null)
    if (!video?.hasWaveform) return
    fetch(`/api/videos/${video.id}/waveform`).then((r) => (r.ok ? r.json() : null)).then(setWave).catch(() => undefined)
  }, [video?.id, video?.hasWaveform])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ left: el.scrollLeft, width: el.clientWidth }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const el = scrollRef.current
    if (!el || !duration) return
    setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, (el.clientWidth - 40) / duration)))
  }, [duration])

  useEffect(() => {
    if (!fitted && duration > 0 && view.width > 100) { fit(); setFitted(true) }
  }, [duration, view.width, fitted, fit])

  // ctrl+wheel zoom around cursor; plain wheel scrolls horizontally
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left
        const t = (el.scrollLeft + x) / pps
        const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        setPps(next)
        requestAnimationFrame(() => { el.scrollLeft = t * next - x })
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pps])

  // follow playhead while playing
  useEffect(() => useTime.subscribe((s) => {
    const el = scrollRef.current
    if (!el || !s.playing) return
    const x = s.time * pps
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = x - 80
  }), [pps])

  const width = Math.max(view.width, duration * pps + 120)
  const ed = useEditor.getState
  const sel = segments.find((s) => s.id === selectedId) ?? null

  const seekFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const el = scrollRef.current!
    const rect = el.getBoundingClientRect()
    player.seek((e.clientX - rect.left + el.scrollLeft) / pps)
  }
  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    seekFromEvent(e)
    const move = (ev: PointerEvent) => seekFromEvent(ev)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const zoomBy = (k: number) => {
    const el = scrollRef.current
    const center = el ? (el.scrollLeft + el.clientWidth / 2) / pps : 0
    const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * k))
    setPps(next)
    requestAnimationFrame(() => { if (el) el.scrollLeft = center * next - el.clientWidth / 2 })
  }

  const time = () => useTime.getState().time
  const segAtPlayhead = () => segments.find((s) => time() > s.start && time() < s.end)

  return (
    <div className="h-full flex flex-col bg-ink-900 select-none">
      <div className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-ink-750">
        <TBtn title="Add caption at playhead" onClick={() => ed().addSegment(time(), 2)}><MessageSquarePlus size={15} /> Add</TBtn>
        <TBtn title="Split caption at playhead" disabled={!segments.length} onClick={() => {
          const s = segAtPlayhead() ?? sel
          if (s) ed().split(s.id, { time: time() })
        }}><Scissors size={15} /> Split</TBtn>
        <TBtn title="Merge selected caption with the next one" disabled={!sel} onClick={() => sel && ed().mergeWithNext(sel.id)}><Merge size={15} /> Merge</TBtn>
        <TBtn title="Duplicate selected caption" disabled={!sel} onClick={() => sel && ed().duplicateSegment(sel.id)}><Copy size={15} /></TBtn>
        <TBtn title="Delete selected caption (Del)" disabled={!sel} onClick={() => sel && ed().deleteSegment(sel.id)}><Trash2 size={15} /></TBtn>
        <div className="flex-1" />
        <PlayheadTime />
        <div className="w-px h-5 bg-ink-700 mx-2" />
        <TBtn title="Zoom out" onClick={() => zoomBy(1 / 1.4)}><Minus size={15} /></TBtn>
        <input type="range" className="slider !w-32" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)}
          style={{ ['--fill' as any]: `${((Math.log(pps) - Math.log(MIN_PPS)) / (Math.log(MAX_PPS) - Math.log(MIN_PPS))) * 100}%` }}
          onChange={(e) => setPps(Math.exp(parseFloat(e.target.value)))} />
        <TBtn title="Zoom in (Ctrl + wheel)" onClick={() => zoomBy(1.4)}><Plus size={15} /></TBtn>
        <TBtn title="Fit timeline to window" onClick={fit}><Maximize2 size={14} /></TBtn>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="shrink-0 border-r border-ink-750 bg-ink-900 text-[11px] text-ink-400" style={{ width: LABEL_W }}>
          <div style={{ height: ROW.ruler }} />
          <TrackLabel h={ROW.audio} icon={<AudioLines size={13} />} label="Audio" />
          <TrackLabel h={ROW.subs} icon={<Type size={13} />} label="Captions" />
        </div>
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden relative"
          onScroll={(e) => setView({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}>
          <div className="relative" style={{ width, height: ROW.ruler + ROW.audio + ROW.subs }}>
            <Ruler pps={pps} view={view} duration={duration} onPointerDown={startScrub} />
            <div className="absolute left-0 right-0 border-b border-ink-800" style={{ top: ROW.ruler, height: ROW.audio }} onPointerDown={startScrub}>
              <WaveCanvas pps={pps} view={view} wave={wave} hasAudio={!!video?.meta?.hasAudio} />
            </div>
            <div className="absolute left-0 right-0" style={{ top: ROW.ruler + ROW.audio, height: ROW.subs }}
              onPointerDown={(e) => { if (e.target === e.currentTarget) { ed().select(null); startScrub(e) } }}>
              <SubtitleTrack segments={segments} pps={pps} view={view} duration={duration} selectedId={selectedId} />
            </div>
            <Playhead pps={pps} height={ROW.ruler + ROW.audio + ROW.subs} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs text-ink-300 hover:bg-ink-750 hover:text-white disabled:opacity-35 disabled:pointer-events-none">
      {children}
    </button>
  )
}

function TrackLabel({ h, icon, label }: { h: number; icon: React.ReactNode; label: string }) {
  return <div className="flex items-center gap-1.5 px-3 border-b border-ink-800" style={{ height: h }}>{icon}{label}</div>
}

function PlayheadTime() {
  const t = useTime((s) => s.time)
  return <span className="font-mono text-[11px] text-ink-400 tabular-nums">{formatTime(t)}</span>
}

function Playhead({ pps, height }: { pps: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const apply = (t: number) => { if (ref.current) ref.current.style.transform = `translateX(${t * pps}px)` }
    apply(useTime.getState().time)
    return useTime.subscribe((s) => apply(s.time))
  }, [pps])
  return (
    <div ref={ref} className="absolute top-0 left-0 pointer-events-none z-20" style={{ height }}>
      <div className="absolute -left-[6px] top-0 w-3 h-3 bg-accent-400 rotate-45 -translate-y-1/2 rounded-sm" />
      <div className="absolute left-[-1px] top-0 bottom-0 w-[2px] bg-accent-400 shadow-[0_0_8px_rgba(154,130,255,.8)]" />
    </div>
  )
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]

function Ruler({ pps, view, duration, onPointerDown }: { pps: number; view: { left: number; width: number }; duration: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = view.width * dpr
    c.height = ROW.ruler * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, view.width, ROW.ruler)
    const step = STEPS.find((s) => s * pps >= 70) ?? 1200
    const minor = step / 5
    const t0 = Math.floor(view.left / pps / minor) * minor
    const t1 = (view.left + view.width) / pps
    g.font = '10px "Segoe UI", sans-serif'
    g.textBaseline = 'top'
    for (let t = t0; t <= t1 + minor; t += minor) {
      const x = Math.round(t * pps - view.left) + 0.5
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6
      g.strokeStyle = major ? '#5a6170' : '#2f3440'
      g.beginPath()
      g.moveTo(x, major ? 12 : 18)
      g.lineTo(x, ROW.ruler)
      g.stroke()
      if (major && t <= duration + 0.001) {
        g.fillStyle = '#8a91a0'
        g.fillText(formatTime(Math.round(t * 10) / 10, step < 1).replace(/\.00$/, ''), x + 3, 2)
      }
    }
  }, [pps, view, duration])
  return (
    <div className="absolute left-0 right-0 top-0 border-b border-ink-750 cursor-pointer bg-ink-900/60" style={{ height: ROW.ruler }} onPointerDown={onPointerDown}>
      <canvas ref={ref} className="absolute top-0" style={{ left: view.left, width: view.width, height: ROW.ruler }} />
    </div>
  )
}

function WaveCanvas({ pps, view, wave, hasAudio }: { pps: number; view: { left: number; width: number }; wave: Waveform | null; hasAudio: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const H = ROW.audio
    c.width = view.width * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, view.width, H)
    if (!wave) return
    const pk = wave.peaks, rate = wave.peaksPerSecond
    const mid = H / 2
    g.fillStyle = '#3ec7a3'
    for (let x = 0; x < view.width; x += 2) {
      const t0 = (view.left + x) / pps, t1 = (view.left + x + 2) / pps
      const i0 = Math.floor(t0 * rate), i1 = Math.max(i0 + 1, Math.ceil(t1 * rate))
      if (i0 >= pk.length) break
      let m = 0
      for (let i = i0; i < i1 && i < pk.length; i++) m = Math.max(m, pk[i])
      const h = Math.max(1, m * (H / 2 - 4))
      g.fillRect(x, mid - h, 1.5, h * 2)
    }
  }, [pps, view, wave])
  return (
    <>
      {!hasAudio && <div className="absolute inset-0 flex items-center px-3 text-[11px] text-ink-500" style={{ left: view.left }}>No audio track</div>}
      <canvas ref={ref} className="absolute top-0" style={{ left: view.left, width: view.width, height: ROW.audio }} />
    </>
  )
}

function SubtitleTrack({ segments, pps, view, duration, selectedId }: { segments: Segment[]; pps: number; view: { left: number; width: number }; duration: number; selectedId: string | null }) {
  const time = useTime((s) => Math.floor(s.time * 10) / 10)
  const t0 = view.left / pps - 5, t1 = (view.left + view.width) / pps + 5
  return (
    <>
      {segments.map((s, i) => (s.end < t0 || s.start > t1 ? null : (
        <SubBlock key={s.id} seg={s} prev={segments[i - 1]} next={segments[i + 1]} pps={pps} duration={duration}
          selected={s.id === selectedId} active={time >= s.start && time < s.end} />
      )))}
    </>
  )
}

function SubBlock({ seg, prev, next, pps, duration, selected, active }: {
  seg: Segment; prev?: Segment; next?: Segment; pps: number; duration: number; selected: boolean; active: boolean
}) {
  const left = seg.start * pps
  const w = Math.max(4, (seg.end - seg.start) * pps)

  const onDown = (e: React.PointerEvent, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useEditor.getState()
    st.select(seg.id)
    if (mode === 'move' && e.detail === 1) player.seek(Math.max(seg.start, Math.min(seg.end - 0.01, useTime.getState().time >= seg.start && useTime.getState().time < seg.end ? useTime.getState().time : seg.start)))
    const x0 = e.clientX
    const s0 = seg.start, e0 = seg.end, d0 = e0 - s0
    const lo = prev ? prev.end : 0
    const hi = next ? next.start : Math.max(duration, e0)
    const key = `tl-${mode}-${seg.id}-${Date.now()}`
    let moved = false
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      moved = true
      if (mode === 'move') {
        const ns = Math.min(Math.max(lo, s0 + dt), hi - d0)
        useEditor.getState().setTiming(seg.id, ns, ns + d0, key)
      } else if (mode === 'l') {
        useEditor.getState().setTiming(seg.id, Math.min(Math.max(lo, s0 + dt), e0 - 0.1), e0, key)
      } else {
        useEditor.getState().setTiming(seg.id, s0, Math.max(Math.min(hi, e0 + dt), s0 + 0.1), key)
      }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={cx('absolute top-[5px] bottom-[5px] rounded-md border text-[11px] leading-tight overflow-hidden group cursor-grab active:cursor-grabbing',
        selected ? 'bg-accent-500/90 border-accent-300 text-white z-10 shadow-[0_0_0_2px_rgba(185,168,255,.35)]'
          : active ? 'bg-accent-600/55 border-accent-400/70 text-white' : 'bg-ink-700 border-ink-600 text-ink-200 hover:border-ink-400')}
      style={{ left, width: w }}
      onPointerDown={(e) => onDown(e, 'move')}
      onDoubleClick={() => useEditor.getState().setEditing(seg.id)}
      title={`${formatTime(seg.start)} → ${formatTime(seg.end)}\n${seg.text}`}
    >
      {pps > 60 && seg.words.map((wd, i) => i === 0 ? null : (
        <div key={i} className="absolute top-0 bottom-0 w-px bg-white/15" style={{ left: (wd.start - seg.start) * pps }} />
      ))}
      <div className="px-2 py-1 truncate font-medium pointer-events-none" dir="auto">{seg.text || '(empty)'}</div>
      <div className="px-2 text-[10px] opacity-60 pointer-events-none tabular-nums">{(seg.end - seg.start).toFixed(1)}s</div>
      <div className="absolute left-0 top-0 bottom-0 w-[7px] cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => onDown(e, 'l')} />
      <div className="absolute right-0 top-0 bottom-0 w-[7px] cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => onDown(e, 'r')} />
    </div>
  )
}
