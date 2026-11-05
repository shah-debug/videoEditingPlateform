import { create } from 'zustand'
import { api, uploadVideo } from '../services/api'
import { toast } from '../components/ui'
import { useEditor } from './store'

export const ACCEPT = '.mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm'
const EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm']

export function validVideo(f: File) {
  return EXT.includes((f.name.split('.').pop() || '').toLowerCase())
}

interface UploadState {
  uploading: boolean
  progress: number
  fileName: string
  localUrl: string | null
  abort: (() => void) | null
  start: (projectId: string, file: File) => Promise<void>
}

/** A file chosen on the Home screen, handed to the editor which performs the upload. */
export const pendingUpload: { file: File | null } = { file: null }

export const useUpload = create<UploadState>((set, get) => ({
  uploading: false,
  progress: 0,
  fileName: '',
  localUrl: null,
  abort: null,
  start: async (projectId, file) => {
    if (!validVideo(file)) {
      toast.error('Unsupported format. Please upload MP4, MOV, AVI, MKV or WEBM.')
      return
    }
    if (get().uploading) return
    // instant local preview while uploading (object URL: the browser streams from disk, no full read)
    const localUrl = URL.createObjectURL(file)
    const { promise, abort } = uploadVideo(projectId, file, (p) => set({ progress: p }))
    set({ uploading: true, progress: 0, fileName: file.name, abort, localUrl })
    try {
      const res = await promise
      useEditor.getState().upsertJob(res.job)
      const p = await api.getProject(projectId)
      const st = useEditor.getState()
      st.setProjectMeta({ video: p.video, name: p.name })
    } catch (e) {
      toast.error(e)
    } finally {
      URL.revokeObjectURL(localUrl)
      set({ uploading: false, abort: null, localUrl: null })
    }
  },
}))
