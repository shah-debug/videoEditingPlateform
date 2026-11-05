import type { FontInfo, Job, Preset, Project, Segment, TranscriptionOptions } from '../types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the backend. Is the Python server running (python backend/run.py)?', 0)
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { /* not json */ }
    throw new ApiError(msg || `HTTP ${res.status}`, res.status)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

export const api = {
  listProjects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (name: string) => request<Project>('POST', '/api/projects', { name }),
  getProject: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  patchProject: (id: string, patch: Partial<Pick<Project, 'name' | 'settings' | 'style'>>) =>
    request<Project>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => request('DELETE', `/api/projects/${id}`),
  history: (id: string) => request<{ id: number; label: string; createdAt: string; segmentCount: number }[]>(
    'GET', `/api/projects/${id}/history`),
  restoreHistory: (id: string, snap: number) => request<Project>('POST', `/api/projects/${id}/history/${snap}/restore`),
  projectJobs: (id: string, active = true) => request<Job[]>('GET', `/api/projects/${id}/jobs?active=${active ? 1 : 0}`),

  saveDocument: (id: string, doc: { segments: Segment[]; style: unknown; settings: unknown; snapshotLabel?: string }) =>
    request<{ ok: boolean; updatedAt: string }>('PUT', `/api/subtitles/${id}`, doc),
  convertScript: (id: string, output: 'roman_urdu' | 'urdu_script') =>
    request<Project>('POST', `/api/subtitles/${id}/convert`, { output }),
  transliterate: (text: string) => request<{ text: string }>('POST', '/api/subtitles/transliterate', { text }),

  transcriptionOptions: () => request<TranscriptionOptions>('GET', '/api/transcription/options'),
  startTranscription: (body: { projectId: string; language: string; output: string; model?: string | null; captionLength: string }) =>
    request<Job>('POST', '/api/transcription/start', body),
  alignTranscript: (body: { projectId: string; text: string; language: string; model?: string | null; captionLength: string; lineMode: 'auto' | 'lines' }) =>
    request<Job>('POST', '/api/transcription/align', body),
  cancelJob: (jobId: string) => request('POST', `/api/jobs/${jobId}/cancel`),
  job: (jobId: string) => request<Job>('GET', `/api/jobs/${jobId}`),

  startExport: (body: Record<string, unknown>) => request<Job>('POST', '/api/export/start', body),
  deleteVideo: (videoId: string) => request('DELETE', `/api/videos/${videoId}`),

  fonts: () => request<FontInfo[]>('GET', '/api/fonts'),
  presets: () => request<Preset[]>('GET', '/api/presets'),
  createPreset: (name: string, style: unknown) => request<Preset>('POST', '/api/presets', { name, style }),
  deletePreset: (id: string) => request('DELETE', `/api/presets/${id}`),

  dictionary: () => request<{ id: number; source: string; target: string }[]>('GET', '/api/dictionary'),
  addDictionary: (source: string, target: string) => request('POST', '/api/dictionary', { source, target }),
  deleteDictionary: (id: number) => request('DELETE', `/api/dictionary/${id}`),
  systemStatus: () => request<any>('GET', '/api/system/status'),
}

/** Streams the File straight from disk (XHR sends the Blob without reading it into JS memory). */
export function uploadFile(url: string, file: File, onProgress: (f: number) => void): { promise: Promise<any>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<any>((resolve, reject) => {
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let data: any = null
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(data?.detail || `Upload failed (${xhr.status})`, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('Upload failed: connection lost', 0))
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0))
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

export function uploadVideo(projectId: string, file: File, onProgress: (f: number) => void) {
  return uploadFile(`/api/videos/upload?projectId=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(file.name)}`,
    file, onProgress)
}

export function connectEvents(projectId: string, onEvent: (e: any) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let timer: number | undefined
  let ping: number | undefined
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/ws?projectId=${encodeURIComponent(projectId)}`)
    ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)) } catch { /* ignore */ } }
    ws.onopen = () => { onEvent({ event: 'connected' }); ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 20000) }
    ws.onclose = () => {
      window.clearInterval(ping)
      if (!closed) timer = window.setTimeout(open, 1500)
    }
  }
  open()
  return () => { closed = true; window.clearTimeout(timer); window.clearInterval(ping); ws?.close() }
}

export const formatBytes = (n: number) => {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export const formatTime = (t: number, ms = true) => {
  if (!isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const cs = Math.floor((t * 100) % 100)
  const base = `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
  return ms ? `${base}.${String(cs).padStart(2, '0')}` : base
}

export const parseTime = (s: string): number | null => {
  const parts = s.trim().split(':').map(Number)
  if (parts.some((p) => isNaN(p))) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}
