import { useMemo, useRef, useState } from 'react'
import { ClipboardPaste, FileUp, Info, Wand2 } from 'lucide-react'
import { useEditor } from '../editor/store'
import { api } from '../services/api'
import { Button, Field, Modal, Segmented, Select, toast } from '../components/ui'
import type { TranscriptionOptions } from '../types'
import { saveNow } from './SubtitlePanel'

const MAX_CHARS = 400_000
const EXAMPLE = 'Assalam alaikum dosto, me kal se Lahore jaunga.\nAaj hum ne naye project ke baare mein meeting ki.'

/** Strip SRT/VTT numbering and timing lines, keeping one line per cue (mirrors parse_transcript on the server). */
function readableLines(text: string): string[] {
  const raw = text.replace(/\r\n?/g, '\n').replace(/﻿/g, '')
  if (!raw.includes('-->')) return raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  let cue: string[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (/^WEBVTT/i.test(s) || /^(NOTE|STYLE|REGION)\b/.test(s)) continue
    if (s.includes('-->') || (/^\d+$/.test(s) && !cue.length)) continue
    if (!s) { if (cue.length) { out.push(cue.join(' ')); cue = [] } continue }
    cue.push(s.replace(/<[^>]+>/g, ''))
  }
  if (cue.length) out.push(cue.join(' '))
  return out
}

export function TranscriptDialog({ opts, onClose }: { opts: TranscriptionOptions; onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const settings = useEditor((s) => s.doc!.settings)
  const count = useEditor((s) => s.doc!.segments.length)
  const [text, setText] = useState('')
  const [language, setLanguage] = useState(settings.sourceLanguage && settings.sourceLanguage !== 'auto' ? settings.sourceLanguage : 'ur')
  const [model, setModel] = useState(settings.model || opts.defaultModel)
  const [length, setLength] = useState(settings.captionLength || 'medium')
  const [lineMode, setLineMode] = useState<'auto' | 'lines'>('auto')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isSubs = text.includes('-->')
  const lines = useMemo(() => readableLines(text), [text])
  const words = useMemo(() => lines.join(' ').split(/\s+/).filter(Boolean).length, [lines])
  const tooLong = text.length > MAX_CHARS
  const m = opts.models.find((x) => x.id === model)

  const loadFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 4 * 1024 * 1024) { toast.error('That file is too large for a transcript (max 4 MB).'); return }
    try {
      const t = await f.text()
      setText(t)
      if (t.includes('-->')) setLineMode('lines')
      toast.info(`Loaded ${f.name}`)
    } catch (e) { toast.error(e) }
  }

  const pasteClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (!t.trim()) { toast.info('The clipboard is empty.'); return }
      setText(t)
      if (t.includes('-->')) setLineMode('lines')
    } catch {
      toast.info('Press Ctrl+V inside the box to paste.')
    }
  }

  const start = async () => {
    if (!words) { toast.error('Paste or upload a transcript first.'); return }
    if (tooLong) { toast.error('The transcript is too long.'); return }
    setBusy(true)
    try {
      useEditor.getState().setSettings({ sourceLanguage: language, model, captionLength: length })
      await saveNow()
      const job = await api.alignTranscript({ projectId: project.id, text, language, model, captionLength: length, lineMode })
      useEditor.getState().upsertJob(job)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Use my own transcript" width={640}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !words || tooLong} onClick={start}><Wand2 size={15} /> Sync to video</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-xs text-ink-400 leading-relaxed">
          Paste the exact words spoken in the video, in <b className="text-ink-200">Roman Urdu</b>, Urdu script or any language.
          The app listens to the video to find <b className="text-ink-200">when</b> each word is said and builds the captions.
          Your spelling is kept exactly as you typed it.
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-400">Transcript</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="subtle" onClick={pasteClipboard}><ClipboardPaste size={13} /> Paste</Button>
              <Button size="sm" variant="subtle" onClick={() => fileRef.current?.click()}><FileUp size={13} /> Open .txt / .srt</Button>
              <input ref={fileRef} type="file" accept=".txt,.srt,.vtt,text/plain" className="hidden"
                onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} dir="auto" spellCheck={false}
            placeholder={EXAMPLE} rows={10} autoFocus
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); loadFile(e.dataTransfer.files?.[0]) }}
            className="w-full resize-y min-h-[180px] max-h-[45vh] bg-ink-800 border border-ink-700 rounded-lg px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-ink-600 focus:outline-none focus:border-accent-500" />
          <div className="flex justify-between text-[11px] text-ink-500">
            <span>{words ? `${words.toLocaleString()} words · ${lines.length.toLocaleString()} lines${isSubs ? ' · subtitle file detected (timings are ignored and re-synced)' : ''}` : 'You can also drop a .txt or .srt file here.'}</span>
            {tooLong && <span className="text-red-300">Too long (max {MAX_CHARS.toLocaleString()} characters)</span>}
          </div>
        </div>

        <Field label="How should captions be split?">
          <Segmented value={lineMode} onChange={setLineMode} options={[
            { id: 'auto', label: 'Fit to screen (automatic)', title: 'Captions are split by sentences and length, like auto-generate' },
            { id: 'lines', label: 'Keep my lines', title: 'Every line you typed becomes one caption' },
          ]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spoken language">
            <Select value={language} onChange={setLanguage} options={opts.languages} />
          </Field>
          {lineMode === 'auto' ? (
            <Field label="Caption length">
              <Select value={length} onChange={setLength} options={opts.captionLengths} />
            </Field>
          ) : <div />}
        </div>
        <Field label="Speech model used for timing">
          <Select value={model} onChange={setModel} options={opts.models.map((x) => ({ id: x.id, label: `${x.label}${x.downloaded ? '' : ` · ${x.sizeMB} MB download`}` }))} />
        </Field>

        <div className="flex gap-2 text-[11px] text-ink-400 bg-ink-800 rounded-lg p-3 leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5 text-accent-300" />
          <div>
            Timing works even when the speech model mishears words, so the small model is usually enough.
            If this video was already transcribed with the same model and language, syncing takes only a few seconds.
            {m && !m.downloaded && <> This model will be downloaded once (~{m.sizeMB} MB).</>}
            {count > 0 && <> Your current {count} captions will be replaced; a restore point is saved and you can undo (Ctrl+Z).</>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
