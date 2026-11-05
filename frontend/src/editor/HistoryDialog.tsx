import { useEffect, useState } from 'react'
import { useEditor } from './store'
import { api } from '../services/api'
import { Button, Modal, toast } from '../components/ui'
import { saveNow } from '../subtitles/SubtitlePanel'

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const [items, setItems] = useState<{ id: number; label: string; createdAt: string; segmentCount: number }[]>([])
  useEffect(() => { api.history(project.id).then(setItems).catch(toast.error) }, [project.id])

  const restore = async (id: number) => {
    if (!confirm('Restore this version? Your current captions are saved as a restore point first.')) return
    try {
      await saveNow()
      const p = await api.restoreHistory(project.id, id)
      useEditor.getState().replaceDocFromServer(p, true)
      toast.success('Version restored')
      onClose()
    } catch (e) { toast.error(e) }
  }

  return (
    <Modal open onClose={onClose} title="Restore points" width={480}>
      <p className="text-xs text-ink-400 mb-3">Saved automatically before regenerating/converting captions, and whenever you press Ctrl+S.</p>
      <div className="rounded-lg border border-ink-750 divide-y divide-ink-750 max-h-[50vh] overflow-y-auto">
        {!items.length && <div className="p-4 text-xs text-ink-500 text-center">No restore points yet.</div>}
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{i.label || 'Snapshot'}</div>
              <div className="text-[11px] text-ink-500">{new Date(i.createdAt).toLocaleString()} · {i.segmentCount} captions</div>
            </div>
            <Button size="sm" variant="subtle" onClick={() => restore(i.id)}>Restore</Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
