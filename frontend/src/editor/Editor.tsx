import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CloudOff, Download, History, Keyboard, Loader2, Redo2, Undo2, UploadCloud, X } from 'lucide-react'
import { player, useEditor, useTime } from './store'
import { ACCEPT, pendingUpload, useUpload } from './upload'
import { api, connectEvents } from '../services/api'
import { useFonts } from '../services/fonts'
import { Button, Kbd, Modal, Progress, cx, toast } from '../components/ui'
import { SubtitlePanel, saveNow } from '../subtitles/SubtitlePanel'
import { StylePanel } from '../settings/StylePanel'
import { VideoPreview } from '../preview/VideoPreview'
import { Timeline } from '../timeline/Timeline'
import { ExportDialog } from '../export/ExportDialog'
import { HistoryDialog } from './HistoryDialog'
import type { Job } from '../types'

function usePanelSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    try { const v = Number(localStorage.getItem(key)); return v >= min && v <= max ? v : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, String(size)) } catch { /* ignore */ } }, [key, size])
  return [size, (v: number) => setSize(Math.min(max, Math.max(min, v)))] as const
}

function Resizer({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    let last = dir === 'x' ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => {
      const cur = dir === 'x' ? ev.clientX : ev.clientY
      onDrag(cur - last)
      last = cur
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = '' }
    document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div onPointerDown={onDown} className={cx('shrink-0 bg-ink-750 hover:bg-accent-500 transition-colors z-10', dir === 'x' ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize')} />
  )
}

export function Editor({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = useEditor((s) => s.project)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [left, setLeft] = usePanelSize('panel-left', 340, 260, 560)
  const [right, setRight] = usePanelSize('panel-right', 320, 260, 520)
  const [bottom, setBottom] = usePanelSize('panel-bottom', 230, 150, 480)
  const initFonts = useFonts((s) => s.init)

  // load project
  useEffect(() => {
    let alive = true
    setError(null)
    useEditor.setState({ project: null, doc: null, jobs: {} })
    Promise.all([api.getProject(projectId), initFonts(), api.projectJobs(projectId)]).then(([p, , jobs]) => {
      if (!alive) return
      useEditor.getState().load(p)
      jobs.forEach((j) => useEditor.getState().upsertJob(j))
      useTime.getState().set({ time: 0, duration: p.video?.meta && 'duration' in p.video.meta ? p.video.meta.duration : 0, playing: false })
      if (pendingUpload.file) {
        const f = pendingUpload.file
        pendingUpload.file = null
        useUpload.getState().start(projectId, f)
      }
    }).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [projectId, initFonts])

  // live job/progress events
  useEffect(() => connectEvents(projectId, async (e) => {
    const st = useEditor.getState()
    if (e.event === 'job') {
      const prev = st.jobs[e.job.id] as Job | undefined
      st.upsertJob(e.job)
      const finished = e.job.status !== prev?.status && ['done', 'error', 'cancelled'].includes(e.job.status)
      if (finished) {
        if (e.job.status === 'error') toast.error(`${labelFor(e.job.type)} failed: ${e.job.error}`)
        else if (e.job.status === 'done' && e.job.type === 'transcribe') toast.success(`Captions generated (${e.job.result?.segments ?? 0} segments)`)
        else if (e.job.status === 'done' && e.job.type === 'process') toast.success('Video is ready')
      }
    } else if (e.event === 'video') {
      const p = await api.getProject(projectId)
      useEditor.getState().setProjectMeta({ video: p.video })
    } else if (e.event === 'subtitles') {
      const p = await api.getProject(projectId)
      useEditor.getState().replaceDocFromServer(p, true)
    }
  }), [projectId])

  // debounced auto-save
  const dirtyVersion = useEditor((s) => s.dirtyVersion)
  useEffect(() => {
    if (!dirtyVersion) return
    const t = setTimeout(() => { saveNow().catch(() => undefined) }, 1200)
    return () => clearTimeout(t)
  }, [dirtyVersion])

  // warn on leaving with unsaved edits
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useEditor.getState().saveState === 'unsaved' || useEditor.getState().saveState === 'saving') { e.preventDefault() } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow('Manual save').then(() => toast.success('Project saved')).catch(toast.error); return }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); st.undo() }
      else if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); st.redo() }
      else if (e.key === ' ') { e.preventDefault(); player.toggle() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedId) { e.preventDefault(); st.deleteSegment(st.selectedId) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(useTime.getState().time - (e.shiftKey ? 5 : 1 / 30 * 3)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(useTime.getState().time + (e.shiftKey ? 5 : 1 / 30 * 3)) }
      else if (e.key.toLowerCase() === 's' && !mod) {
        const time = useTime.getState().time
        const seg = st.doc?.segments.find((s) => time > s.start && time < s.end)
        if (seg) st.split(seg.id, { time })
      } else if (e.key === 'Enter' && st.selectedId) { e.preventDefault(); st.setEditing(st.selectedId) }
      else if (e.key === 'Escape') st.select(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (error) return <div className="h-full flex flex-col items-center justify-center gap-4 text-ink-300"><p>{error}</p><Button variant="subtle" onClick={onBack}>Back to projects</Button></div>
  if (!project) return <div className="h-full flex items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div>

  return (
    <div className="h-full flex flex-col">
      <TopBar onBack={onBack} onExport={() => setExportOpen(true)} onHistory={() => setHistoryOpen(true)} onKeys={() => setKeysOpen(true)} />
      <div className="flex-1 min-h-0 flex">
        <aside className="shrink-0 bg-ink-900 min-h-0" style={{ width: left }}><SubtitlePanel /></aside>
        <Resizer dir="x" onDrag={(d) => setLeft(left + d)} />
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0">{project.video ? <VideoPreview /> : <EmptyStage />}</div>
          <Resizer dir="y" onDrag={(d) => setBottom(bottom - d)} />
          <div className="shrink-0 min-h-0" style={{ height: bottom }}><Timeline /></div>
        </main>
        <Resizer dir="x" onDrag={(d) => setRight(right - d)} />
        <aside className="shrink-0 bg-ink-900 min-h-0" style={{ width: right }}><StylePanel /></aside>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
      <Modal open={keysOpen} onClose={() => setKeysOpen(false)} title="Keyboard shortcuts" width={420}>
        <div className="space-y-2 text-sm">
          {[['Play / pause', 'Space'], ['Undo', 'Ctrl + Z'], ['Redo', 'Ctrl + Shift + Z'], ['Save project', 'Ctrl + S'], ['Delete selected caption', 'Delete'],
            ['Edit selected caption', 'Enter'], ['Split caption at playhead', 'S'], ['Step back / forward', '← / →'], ['Jump 5 seconds', 'Shift + ← / →'],
            ['Zoom timeline', 'Ctrl + mouse wheel'], ['Deselect', 'Esc']].map(([a, b]) => (
            <div key={a} className="flex justify-between"><span className="text-ink-300">{a}</span><Kbd>{b}</Kbd></div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

const labelFor = (t: string) => (t === 'transcribe' ? 'Caption generation' : t === 'export' ? 'Export' : 'Video processing')

function TopBar({ onBack, onExport, onHistory, onKeys }: { onBack: () => void; onExport: () => void; onHistory: () => void; onKeys: () => void }) {
  const project = useEditor((s) => s.project)!
  const saveState = useEditor((s) => s.saveState)
  const saveError = useEditor((s) => s.saveError)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const jobs = useEditor((s) => s.jobs)
  const [name, setName] = useState(project.name)
  useEffect(() => setName(project.name), [project.name])
  const rename = async () => {
    const n = name.trim()
    if (!n || n === project.name) { setName(project.name); return }
    try { await api.patchProject(project.id, { name: n }); useEditor.getState().setProjectMeta({ name: n }) } catch (e) { toast.error(e) }
  }
  const active = Object.values(jobs).filter((j) => j.status === 'running' || j.status === 'queued')

  return (
    <header className="h-14 shrink-0 flex items-center gap-2 px-3 border-b border-ink-750 bg-ink-900">
      <Button size="icon" title="All projects" onClick={async () => { await saveNow().catch(() => undefined); onBack() }}><ArrowLeft size={17} /></Button>
      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent-500 to-fuchsia-500 flex items-center justify-center text-white text-[11px] font-bold">CC</div>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="bg-transparent hover:bg-ink-800 focus:bg-ink-800 rounded-md px-2 h-8 text-sm font-semibold text-white w-64 focus:outline-none focus:ring-1 focus:ring-accent-500" />
      <SaveBadge state={saveState} error={saveError} />
      <div className="flex-1 flex justify-center">
        {active.map((j) => <JobPill key={j.id} job={j} />)}
      </div>
      <Button size="icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}><Undo2 size={17} /></Button>
      <Button size="icon" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}><Redo2 size={17} /></Button>
      <Button size="icon" title="Restore points" onClick={onHistory}><History size={17} /></Button>
      <Button size="icon" title="Keyboard shortcuts" onClick={onKeys}><Keyboard size={17} /></Button>
      <Button variant="primary" onClick={onExport} disabled={project.video?.status !== 'ready'} className="ml-1"><Download size={15} /> Export</Button>
    </header>
  )
}

function SaveBadge({ state, error }: { state: string; error: string | null }) {
  if (state === 'saving') return <span className="text-[11px] text-ink-400 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving…</span>
  if (state === 'unsaved') return <span className="text-[11px] text-ink-500">Unsaved changes</span>
  if (state === 'error') return <span className="text-[11px] text-red-300 inline-flex items-center gap-1" title={error ?? ''}><CloudOff size={12} /> Save failed</span>
  return <span className="text-[11px] text-ink-500 inline-flex items-center gap-1"><Check size={12} /> Saved</span>
}

function JobPill({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-2.5 h-8 pl-3 pr-1.5 rounded-full bg-ink-800 border border-ink-700 mx-1 max-w-[380px]">
      <Loader2 size={13} className="animate-spin text-accent-400 shrink-0" />
      <span className="text-[11px] text-ink-200 truncate">{job.stage || labelFor(job.type)}</span>
      <Progress value={job.progress} className="w-20 shrink-0" />
      <span className="text-[10px] text-ink-400 w-8 tabular-nums">{Math.round(job.progress * 100)}%</span>
      {job.type !== 'process' && (
        <button title="Cancel" className="h-5 w-5 rounded-full hover:bg-ink-700 text-ink-400 hover:text-red-300 flex items-center justify-center"
          onClick={() => api.cancelJob(job.id).catch(toast.error)}><X size={12} /></button>
      )}
    </div>
  )
}

function EmptyStage() {
  const project = useEditor((s) => s.project)!
  const up = useUpload()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) up.start(project.id, f)
  }, [project.id, up])
  return (
    <div className="h-full flex items-center justify-center checker p-8" onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) up.start(project.id, f) }} />
      {up.uploading ? (
        <div className="w-full max-w-xl space-y-4">
          {up.localUrl && <video src={up.localUrl} muted className="w-full max-h-[40vh] rounded-xl bg-black" />}
          <div className="text-sm text-white">Uploading {up.fileName}</div>
          <Progress value={up.progress} className="h-2" />
          <div className="flex justify-between text-xs text-ink-400"><span>{Math.round(up.progress * 100)}%</span><button onClick={() => up.abort?.()} className="hover:text-red-300">Cancel</button></div>
        </div>
      ) : (
        <button onClick={() => input.current?.click()} className={cx('w-full max-w-xl aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-colors',
          over ? 'border-accent-400 bg-accent-500/10' : 'border-ink-600 hover:border-accent-500 bg-ink-900/60')}>
          <UploadCloud size={40} className="text-accent-400" />
          <div className="text-white font-medium">Drop a video here or click to upload</div>
          <div className="text-xs text-ink-400">MP4 · MOV · AVI · MKV · WEBM: large files are streamed straight to disk</div>
        </button>
      )}
    </div>
  )
}
