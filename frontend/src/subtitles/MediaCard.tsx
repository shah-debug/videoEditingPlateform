import { useOwnerWindow } from '../editor/PopoutWindow'
import { useRef } from 'react'
import { FileVideo, RefreshCw, Trash2 } from 'lucide-react'
import { useEditor } from '../editor/store'
import { ACCEPT, useUpload } from '../editor/upload'
import { api, formatBytes, formatTime } from '../services/api'
import { Progress, toast } from '../components/ui'

export function MediaCard() {
  const win = useOwnerWindow()
  const project = useEditor((s) => s.project)
  const jobs = useEditor((s) => s.jobs)
  const up = useUpload()
  const input = useRef<HTMLInputElement>(null)
  const v = project?.video
  if (!project) return null
  const meta = v?.meta && 'width' in v.meta ? v.meta : null
  const proc = Object.values(jobs).find((j) => j.type === 'process' && j.projectId === project.id && (j.status === 'running' || j.status === 'queued'))

  const remove = async () => {
    if (!v || !win.confirm('Remove this video from the project? Captions are kept.')) return
    try {
      await api.deleteVideo(v.id)
      useEditor.getState().setProjectMeta({ video: null })
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="px-4 pt-4 pb-3 border-b border-ink-750">
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) up.start(project.id, f)
      }} />
      {up.uploading ? (
        <div className="space-y-2">
          <div className="text-xs text-ink-300 truncate">Uploading {up.fileName}</div>
          <Progress value={up.progress} />
          <div className="flex justify-between text-[11px] text-ink-500"><span>{Math.round(up.progress * 100)}%</span>
            <button className="hover:text-red-300" onClick={() => up.abort?.()}>Cancel</button></div>
        </div>
      ) : v ? (
        <div className="flex gap-3">
          <div className="h-12 w-12 shrink-0 rounded-lg bg-ink-800 flex items-center justify-center">
            <FileVideo size={18} className="text-ink-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-white truncate font-medium" title={v.originalFilename}>{v.originalFilename}</div>
            {meta ? (
              <div className="text-[11px] text-ink-400 leading-relaxed">
                {formatTime(meta.duration, false)} · {meta.width}×{meta.height} · {meta.fps} fps<br />
                {formatBytes(v.sizeBytes)} · {meta.container?.toUpperCase()} ({meta.videoCodec}{meta.audioCodec ? ` / ${meta.audioCodec}` : ', no audio'})
              </div>
            ) : <div className="text-[11px] text-ink-400">{v.status === 'error' ? <span className="text-red-300">{v.error}</span> : 'Analysing…'}</div>}
          </div>
          <div className="flex flex-col gap-1">
            <button title="Replace video" className="h-6 w-6 rounded-md text-ink-400 hover:text-white hover:bg-ink-750 flex items-center justify-center" onClick={() => input.current?.click()}><RefreshCw size={13} /></button>
            <button title="Remove video" className="h-6 w-6 rounded-md text-ink-400 hover:text-red-300 hover:bg-ink-750 flex items-center justify-center" onClick={remove}><Trash2 size={13} /></button>
          </div>
        </div>
      ) : (
        <button onClick={() => input.current?.click()} className="w-full h-12 rounded-lg border border-dashed border-ink-600 text-xs text-ink-400 hover:border-accent-500 hover:text-white">
          Upload a video
        </button>
      )}
      {proc && (
        <div className="mt-2.5 space-y-1">
          <div className="text-[11px] text-ink-400 truncate">{proc.stage}</div>
          <Progress value={proc.progress} />
        </div>
      )}
    </div>
  )
}
