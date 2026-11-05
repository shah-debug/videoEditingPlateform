import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useEditor } from '../editor/store'
import { api } from '../services/api'
import { Button, Field, Modal, Select, toast } from '../components/ui'
import type { TranscriptionOptions } from '../types'
import { saveNow } from './SubtitlePanel'

export function GenerateDialog({ opts, onClose }: { opts: TranscriptionOptions; onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const settings = useEditor((s) => s.doc!.settings)
  const count = useEditor((s) => s.doc!.segments.length)
  const [language, setLanguage] = useState(settings.sourceLanguage || 'auto')
  const [output, setOutput] = useState(settings.outputScript || 'original')
  const [model, setModel] = useState(settings.model || opts.defaultModel)
  const [length, setLength] = useState(settings.captionLength || 'medium')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      useEditor.getState().setSettings({ sourceLanguage: language, outputScript: output, model, captionLength: length })
      await saveNow()
      const job = await api.startTranscription({ projectId: project.id, language, output, model, captionLength: length })
      useEditor.getState().upsertJob(job)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const m = opts.models.find((x) => x.id === model)
  const urduOut = output === 'roman_urdu' || output === 'urdu_script'
  return (
    <Modal open onClose={onClose} title={count ? 'Regenerate captions' : 'Auto generate captions'} width={480}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={start}><Sparkles size={15} /> Generate</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spoken language">
            <Select value={language} onChange={setLanguage} options={opts.languages} />
          </Field>
          <Field label="Caption output">
            <Select value={output} onChange={setOutput} options={opts.outputs} />
          </Field>
        </div>
        {output === 'roman_urdu' && (
          <p className="text-xs text-ink-400 leading-relaxed bg-ink-800 rounded-lg p-3">
            The speech is first transcribed in <b className="text-ink-200">Urdu script</b>, then transliterated word by word to Roman Urdu
            (e.g. <bdi dir="rtl">میں کل لاہور جاؤں گا</bdi> → <bdi>“Me kal Lahore jaunga”</bdi>). This is <b className="text-ink-200">not</b> a translation;
            word order and names are kept. You can fix spellings and save them in the Roman Urdu dictionary.
          </p>
        )}
        {urduOut && language === 'auto' && (
          <p className="text-[11px] text-amber-200/80">Tip: choose “Urdu” as the spoken language for the most reliable Urdu results.</p>
        )}
        <Field label="Speech model (accuracy vs speed)">
          <Select value={model} onChange={setModel} options={opts.models.map((x) => ({ id: x.id, label: `${x.label}${x.downloaded ? '' : ` · ${x.sizeMB} MB download`}` }))} />
        </Field>
        {m && !m.downloaded && <p className="text-[11px] text-ink-400">This model will be downloaded once (~{m.sizeMB} MB) and cached locally.</p>}
        {urduOut && ['tiny', 'base'].includes(model) && <p className="text-[11px] text-amber-200/80">Tiny/Base models are weak for Urdu. Small or larger is recommended.</p>}
        <Field label="Caption length">
          <Select value={length} onChange={setLength} options={opts.captionLengths} />
        </Field>
        {count > 0 && <p className="text-[11px] text-ink-400">Your current {count} captions will be replaced. A restore point is saved and you can also undo (Ctrl+Z).</p>}
        <p className="text-[11px] text-ink-500">Runs locally on your computer. AI transcription is never 100% accurate, so review the captions afterwards.</p>
      </div>
    </Modal>
  )
}
