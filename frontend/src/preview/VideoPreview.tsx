import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize, Minimize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { player, useEditor, useTime } from '../editor/store'
import { formatTime } from '../services/api'
import { CaptionOverlay } from './CaptionOverlay'
import { outputSize } from './captionLayout'
import { Select, Segmented, cx } from '../components/ui'

const ZOOMS = [{ id: 'fit', label: 'Fit' }, { id: '0.5', label: '50%' }, { id: '0.75', label: '75%' }, { id: '1.5', label: '150%' }, { id: '2', label: '200%' }, { id: '3', label: '300%' }]

export function VideoPreview() {
  const project = useEditor((s) => s.project)
  const settings = useEditor((s) => s.doc?.settings)
  const video = project?.video
  const meta = video?.meta && 'width' in video.meta ? video.meta : null
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const vRef = useRef<HTMLVideoElement>(null)
  const [box, setBox] = useState({ w: 800, h: 450 })
  const [zoom, setZoom] = useState('fit')
  const [muted, setMuted] = useState(false)
  const [fs, setFs] = useState(false)
  const { playing, duration } = useTime()

  // available stage size
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // video element <-> time store
  useEffect(() => {
    const v = vRef.current
    player.attach(v)
    if (!v) return
    let raf = 0
    const loop = () => {
      useTime.getState().set({ time: v.currentTime })
      raf = requestAnimationFrame(loop)
    }
    const onPlay = () => { useTime.getState().set({ playing: true }); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
    const onPause = () => { useTime.getState().set({ playing: false, time: v.currentTime }); cancelAnimationFrame(raf) }
    const onMeta = () => useTime.getState().set({ duration: v.duration || meta?.duration || 0 })
    const onSeek = () => useTime.getState().set({ time: v.currentTime })
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onPause)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('seeked', onSeek)
    v.addEventListener('timeupdate', onSeek)
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('ended', onPause)
      v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('seeked', onSeek); v.removeEventListener('timeupdate', onSeek)
      player.attach(null)
    }
  }, [video?.id, video?.hasProxy, meta?.duration])

  useEffect(() => {
    if (meta?.duration) useTime.getState().set({ duration: meta.duration })
  }, [meta?.duration])

  useEffect(() => {
    const h = () => setFs(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  if (!video || !settings) return null
  const srcW = meta?.width || 1920, srcH = meta?.height || 1080
  const [W, H] = outputSize(srcW, srcH, settings.aspectRatio, 'original')
  const pad = 24
  // zoom is relative to the "fit" size
  const fitScale = Math.max(0.05, Math.min((box.w - pad * 2) / W, (box.h - pad * 2) / H))
  const s = zoom === 'fit' ? fitScale : fitScale * parseFloat(zoom)
  const dw = W * s, dh = H * s
  const src = video.streamUrl
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : wrapRef.current?.requestFullscreen())

  return (
    <div ref={wrapRef} className="flex flex-col h-full min-h-0 bg-ink-950">
      <div ref={stageRef} className="flex-1 min-h-0 overflow-auto checker" onMouseDown={(e) => { if (e.target === e.currentTarget) useEditor.getState().select(null) }}>
        <div className="min-w-full min-h-full flex items-center justify-center" style={{ padding: pad, width: Math.max(box.w, dw + pad * 2), height: Math.max(box.h, dh + pad * 2) }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) useEditor.getState().select(null) }}>
          <div className="relative shadow-[0_10px_40px_rgba(0,0,0,.6)] overflow-hidden shrink-0" style={{ width: dw, height: dh, background: settings.padColor }}>
            <video
              key={video.id + (video.hasProxy ? 'p' : '')}
              ref={vRef}
              src={src}
              muted={muted}
              preload="auto"
              playsInline
              onClick={() => player.toggle()}
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: settings.fitMode === 'fill' ? 'cover' : 'contain' }}
            />
            <CaptionOverlay frameW={W} frameH={H} displayScale={s} />
          </div>
        </div>
      </div>
      <div className="h-12 shrink-0 border-t border-ink-750 bg-ink-900 flex items-center gap-2 px-3">
        <button className="h-8 w-8 rounded-lg text-ink-300 hover:bg-ink-750 hover:text-white flex items-center justify-center" title="Back 5s" onClick={() => player.seek(useTime.getState().time - 5)}><SkipBack size={16} /></button>
        <button className="h-9 w-9 rounded-full bg-white text-ink-950 hover:bg-ink-200 flex items-center justify-center" title="Play/Pause (Space)" onClick={() => player.toggle()}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <button className="h-8 w-8 rounded-lg text-ink-300 hover:bg-ink-750 hover:text-white flex items-center justify-center" title="Forward 5s" onClick={() => player.seek(useTime.getState().time + 5)}><SkipForward size={16} /></button>
        <TimeReadout duration={duration} />
        <button className="h-8 w-8 rounded-lg text-ink-300 hover:bg-ink-750 hover:text-white flex items-center justify-center" onClick={() => setMuted(!muted)} title="Mute">
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-ink-500 hidden xl:inline">{W}×{H}</span>
        <div className="w-[260px]">
          <Segmented size="sm" value={settings.aspectRatio} onChange={(v) => useEditor.getState().setSettings({ aspectRatio: v })}
            options={[{ id: 'original', label: 'Original' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }, { id: '1:1', label: '1:1' }, { id: '4:5', label: '4:5' }]} />
        </div>
        <div className={cx('w-[110px]', settings.aspectRatio === 'original' && 'opacity-40 pointer-events-none')}>
          <Segmented size="sm" value={settings.fitMode} onChange={(v) => useEditor.getState().setSettings({ fitMode: v })}
            options={[{ id: 'fit', label: 'Fit', title: 'Show the whole video (adds bars)' }, { id: 'fill', label: 'Fill', title: 'Fill the frame (crops edges)' }]} />
        </div>
        {settings.aspectRatio !== 'original' && settings.fitMode === 'fit' && (
          <input type="color" className="swatch !w-6 !h-6" title="Bar colour" value={settings.padColor}
            onChange={(e) => useEditor.getState().setSettings({ padColor: e.target.value }, 'pad')} />
        )}
        <Select className="w-[76px]" value={zoom} onChange={setZoom} options={ZOOMS} />
        <button className="h-8 w-8 rounded-lg text-ink-300 hover:bg-ink-750 hover:text-white flex items-center justify-center" onClick={toggleFs} title="Fullscreen preview">
          {fs ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
    </div>
  )
}

function TimeReadout({ duration }: { duration: number }) {
  const t = useTime((s) => s.time)
  return (
    <div className="font-mono text-xs tabular-nums text-ink-300 px-2">
      <span className="text-white">{formatTime(t)}</span><span className="text-ink-500"> / {formatTime(duration)}</span>
    </div>
  )
}
