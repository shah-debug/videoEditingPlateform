import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../services/api'
import { Button, Modal, toast } from '../components/ui'

export function DictionaryDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<{ id: number; source: string; target: string }[]>([])
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const [test, setTest] = useState('')
  const [out, setOut] = useState('')
  const load = () => api.dictionary().then(setItems).catch(toast.error)
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!test.trim()) { setOut(''); return }
    const t = setTimeout(() => api.transliterate(test).then((r) => setOut(r.text)).catch(() => undefined), 250)
    return () => clearTimeout(t)
  }, [test, items])

  const add = async () => {
    if (!src.trim() || !dst.trim()) return
    try { await api.addDictionary(src, dst); setSrc(''); setDst(''); load() } catch (e) { toast.error(e) }
  }

  return (
    <Modal open onClose={onClose} title="Roman Urdu dictionary" width={520}>
      <p className="text-xs text-ink-400 mb-4 leading-relaxed">
        Your spellings override the built-in transliteration everywhere (names, slang, brand names). After adding words,
        click “Roman Urdu” in the captions panel to re-apply them.
      </p>
      <div className="flex gap-2 mb-4">
        <input dir="rtl" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="اردو لفظ"
          className="flex-1 h-9 bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm focus:outline-none focus:border-accent-500" />
        <input value={dst} onChange={(e) => setDst(e.target.value)} placeholder="Roman spelling" onKeyDown={(e) => e.key === 'Enter' && add()}
          className="flex-1 h-9 bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm focus:outline-none focus:border-accent-500" />
        <Button variant="primary" onClick={add}><Plus size={15} /></Button>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-ink-750 divide-y divide-ink-750 mb-4">
        {!items.length && <div className="p-4 text-xs text-ink-500 text-center">No custom words yet.</div>}
        {items.map((i) => (
          <div key={i.id} className="flex items-center px-3 py-2 text-sm">
            <span dir="rtl" className="flex-1 text-ink-200">{i.source}</span>
            <span className="flex-1 text-white">{i.target}</span>
            <button className="text-ink-500 hover:text-red-300" onClick={async () => { await api.deleteDictionary(i.id); load() }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-xs text-ink-400">Try it</div>
        <input dir="rtl" value={test} onChange={(e) => setTest(e.target.value)} placeholder="میں کل لاہور جاؤں گا"
          className="w-full h-9 bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm focus:outline-none focus:border-accent-500" />
        <div className="min-h-9 rounded-lg bg-ink-900 border border-ink-750 px-3 py-2 text-sm text-accent-300">{out || '—'}</div>
      </div>
    </Modal>
  )
}
