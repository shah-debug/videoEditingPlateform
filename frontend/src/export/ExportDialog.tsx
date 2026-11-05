import { useState } from 'react'
import { Download, Film, FileText, X } from 'lucide-react'
import { useEditor } from '../editor/store'
import { api, formatBytes } from '../services/api'
import { Button, Field, Modal, Progress, Select, Toggle, toast } from '../components/ui'
import { saveNow } from '../subtitles/SubtitlePanel'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const jobs = useEditor((s) => s.jobs)
  const [burn, setBurn] = useState(true)
  const [resolution, setResolution] = useState('original')
  const [fps, setFps] = useState('original')
  const [name, setName] = useState(project.name)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = jobId ? jobs[jobId] : null
  const meta = project.video?.meta && 'width' in project.video.meta ? project.video.meta : null

  const start = async () => {
    try {
      await saveNow()
      const j = await api.startExport({
        projectId: project.id, renderVideo: true, burnCaptions: burn, resolution, fps, codec: 'h264', quality: 'high',
        subtitleFormats: [], filename: name,
      })
      useEditor.getState().upsertJob(j)
      setJobId(j.id)
    } catch (e) { toast.error(e) }
  }

  const running = job && (job.status === 'running' || job.status === 'queued')
  const done = job?.status === 'done'
  const files: Record<string, string> = (job?.result?.files as Record<string, string>) ?? {}
  const sizes: Record<string, number> = (job?.result?.sizes as Record<string, number>) ?? {}

  return (
    <Modal open onClose={onClose} title="Export" width={done && files.mp4 ? 760 : 520}>
      {!job || job.status === 'error' || job.status === 'cancelled' ? (
        <div className="space-y-4">
          {job?.status === 'error' && <div className="text-xs text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-3 whitespace-pre-wrap">{job.error}</div>}
          {job?.status === 'cancelled' && <div className="text-xs text-ink-300 bg-ink-800 rounded-lg p-3">Export cancelled.</div>}
          <Field label="File name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm focus:outline-none focus:border-accent-500" />
          </Field>
          <div className="rounded-xl border border-ink-700 p-3.5 space-y-3">
            <Toggle label="Burn captions into the video" checked={burn} onChange={setBurn} />
            <div className="grid grid-cols-2 gap-3">
                <Field label="Resolution">
                  <Select value={resolution} onChange={setResolution} options={[{ id: 'original', label: 'Original' }, { id: '720p', label: '720p' }, { id: '1080p', label: '1080p' }, { id: '4k', label: '4K (2160p)' }]} />
                </Field>
                <Field label="Frame rate">
                  <Select value={fps} onChange={setFps} options={[{ id: 'original', label: `Original${meta ? ` (${meta.fps})` : ''}` }, { id: '24', label: '24 fps' }, { id: '25', label: '25 fps' }, { id: '30', label: '30 fps' }, { id: '60', label: '60 fps' }]} />
                </Field>
              </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={start}><Download size={15} /> Export</Button>
          </div>
        </div>
      ) : running ? (
        <div className="space-y-4 py-4">
          <div className="text-sm text-white">{job.stage || 'Starting'}…</div>
          <Progress value={job.progress} className="h-2" />
          <div className="flex justify-between text-xs text-ink-400">
            <span>{Math.round(job.progress * 100)}%</span>
            <button className="inline-flex items-center gap-1 hover:text-red-300" onClick={() => api.cancelJob(job.id).catch(toast.error)}><X size={13} /> Cancel</button>
          </div>
          <p className="text-[11px] text-ink-500">Rendering uses FFmpeg on your CPU; long videos can take a while. You can keep editing.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {files.mp4 && (
            <video controls className="w-full max-h-[52vh] rounded-xl bg-black" src={`/api/export/${job!.id}/download?file=mp4&inline=1`} />
          )}
          <div className="text-xs text-ink-400">Export finished{job?.result?.width ? ` · ${job.result.width}×${job.result.height}` : ''}. Preview it above, then download.</div>
          {job?.result?.folder && (
            <div className="text-[11px] text-ink-400 bg-ink-800 rounded-lg px-3 py-2">
              Also saved on this PC: <span className="font-mono text-ink-200 break-all select-all">{String(job.result.folder)}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {Object.entries(files).map(([k]) => (
              <a key={k} href={`/api/export/${job!.id}/download?file=${k}`} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm bg-ink-750 hover:bg-ink-700 border border-ink-700 text-white">
                {k === 'mp4' ? <Film size={15} /> : <FileText size={15} />} {k.toUpperCase()} <span className="text-ink-400 text-xs">{formatBytes(sizes[k] ?? 0)}</span>
              </a>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setJobId(null)}>New export</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
