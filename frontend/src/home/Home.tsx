import { useEffect, useRef, useState } from 'react'
import { Clock, Film, Loader2, MoreHorizontal, Pencil, Plus, Trash2, UploadCloud } from 'lucide-react'
import { api, formatBytes, formatTime } from '../services/api'
import { ACCEPT, pendingUpload, validVideo } from '../editor/upload'
import { Button, cx, toast } from '../components/ui'
import type { Project } from '../types'

export function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [over, setOver] = useState(false)
  const [status, setStatus] = useState<any>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = () => api.listProjects().then(setProjects).catch((e) => { toast.error(e); setProjects([]) })
  useEffect(() => { load(); api.systemStatus().then(setStatus).catch(() => undefined) }, [])

  const createWith = async (file?: File) => {
    if (file && !validVideo(file)) { toast.error('Unsupported format. Please upload MP4, MOV, AVI, MKV or WEBM.'); return }
    try {
      const p = await api.createProject(file ? file.name.replace(/\.[^.]+$/, '') : 'Untitled project')
      pendingUpload.file = file ?? null
      onOpen(p.id)
    } catch (e) { toast.error(e) }
  }

  const missing = status && (!status.binaries?.ffmpeg?.ok || !status.binaries?.libass)

  return (
    <div className="h-full overflow-y-auto">
      <header className="h-16 flex items-center gap-3 px-8 border-b border-ink-800">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent-500 to-fuchsia-500 flex items-center justify-center text-white text-xs font-bold">CC</div>
        <div>
          <div className="text-white font-semibold leading-tight">AI Caption Studio</div>
          <div className="text-[11px] text-ink-500">Local AI subtitles · Urdu · Roman Urdu · English · 30+ languages</div>
        </div>
        <div className="flex-1" />
        {status && <span className="text-[11px] text-ink-500">Whisper on {status.whisper.device.toUpperCase()} ({status.whisper.computeType}) · default model “{status.whisper.defaultModel}”</span>}
      </header>
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        {missing && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            FFmpeg {status.binaries?.ffmpeg?.ok ? 'is missing libass (subtitle rendering)' : 'was not found'}. Install a full FFmpeg build and add it to PATH (see README).
          </div>
        )}
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) createWith(f) }} />
        <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) createWith(f) }}
          onClick={() => input.current?.click()}
          className={cx('cursor-pointer rounded-2xl border-2 border-dashed h-56 flex flex-col items-center justify-center gap-3 transition-all',
            over ? 'border-accent-400 bg-accent-500/10 scale-[1.01]' : 'border-ink-700 hover:border-accent-500 bg-[radial-gradient(ellipse_at_top,rgba(124,92,255,.12),transparent_70%)]')}>
          <UploadCloud size={42} className="text-accent-400" />
          <div className="text-lg text-white font-semibold">Upload a video to start captioning</div>
          <div className="text-sm text-ink-400">Drag & drop or click · MP4, MOV, AVI, MKV, WEBM · your original video is never modified</div>
        </div>

        <div>
          <div className="flex items-center mb-4">
            <h2 className="text-white font-semibold flex-1">Your projects</h2>
            <Button variant="subtle" size="sm" onClick={() => createWith()}><Plus size={14} /> Empty project</Button>
          </div>
          {!projects ? <Loader2 className="animate-spin text-ink-500" /> : projects.length === 0 ? (
            <div className="text-sm text-ink-500">No projects yet.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {projects.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.id)} onChanged={load} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ p, onOpen, onChanged }: { p: Project; onOpen: () => void; onChanged: () => void }) {
  const [menu, setMenu] = useState(false)
  const v = p.video
  const meta = v?.meta && 'duration' in v.meta ? v.meta : null
  const rename = async () => {
    setMenu(false)
    const n = prompt('Rename project', p.name)
    if (!n?.trim()) return
    try { await api.patchProject(p.id, { name: n.trim() }); onChanged() } catch (e) { toast.error(e) }
  }
  const del = async () => {
    setMenu(false)
    if (!confirm(`Delete “${p.name}”? This removes its uploaded video, captions and exports.`)) return
    try { await api.deleteProject(p.id); onChanged() } catch (e) { toast.error(e) }
  }
  return (
    <div className="group relative rounded-2xl border border-ink-750 bg-ink-900 hover:border-ink-600 overflow-hidden cursor-pointer transition-colors" onClick={onOpen}>
      <div className="aspect-video bg-ink-800 flex items-center justify-center relative">
        <Film size={28} className="text-ink-600" />
        {meta && <span className="absolute bottom-2 right-2 text-[10px] bg-black/70 rounded px-1.5 py-0.5 text-white font-mono">{formatTime(meta.duration, false)}</span>}
      </div>
      <div className="p-3">
        <div className="text-sm text-white font-medium truncate">{p.name}</div>
        <div className="text-[11px] text-ink-500 flex items-center gap-1.5 mt-0.5">
          <Clock size={11} /> {new Date(p.updatedAt).toLocaleDateString()} · {p.segmentCount ?? 0} captions{v ? ` · ${formatBytes(v.sizeBytes)}` : ''}
        </div>
      </div>
      <button className="absolute top-2 right-2 h-7 w-7 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); setMenu(!menu) }}><MoreHorizontal size={15} /></button>
      {menu && (
        <div className="absolute top-10 right-2 z-10 w-36 rounded-xl bg-ink-850 border border-ink-700 shadow-xl p-1 anim-in" onClick={(e) => e.stopPropagation()}>
          <button className="w-full text-left px-3 py-2 rounded-lg text-xs text-ink-200 hover:bg-ink-750 inline-flex items-center gap-2" onClick={rename}><Pencil size={13} /> Rename</button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-300 hover:bg-ink-750 inline-flex items-center gap-2" onClick={del}><Trash2 size={13} /> Delete</button>
        </div>
      )}
    </div>
  )
}
