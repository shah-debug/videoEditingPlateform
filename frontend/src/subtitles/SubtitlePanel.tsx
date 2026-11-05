import { useEffect, useMemo, useRef, useState } from 'react'
import { BookA, ClipboardPaste, Copy, Languages, Merge, Plus, RefreshCw, Scissors, Search, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { player, useEditor, useTime } from '../editor/store'
import { api, formatTime, parseTime } from '../services/api'
import { Button, Select, cx, toast } from '../components/ui'
import { GenerateDialog } from './GenerateDialog'
import { TranscriptDialog } from './TranscriptDialog'
import { DictionaryDialog } from './DictionaryDialog'
import { MediaCard } from './MediaCard'
import type { Segment, TranscriptionOptions } from '../types'
import { tokenize } from './wordSync'

const LANG_FALLBACK = [{ id: 'auto', label: 'Auto detect' }, { id: 'en', label: 'English' }, { id: 'ur', label: 'Urdu' }]
const OUT_FALLBACK = [{ id: 'original', label: 'Original language' }, { id: 'roman_urdu', label: 'Roman Urdu' },
  { id: 'urdu_script', label: 'Urdu script' }, { id: 'english', label: 'English translation' }]

export function SubtitlePanel() {
  const project = useEditor((s) => s.project)
  const segments = useEditor((s) => s.doc?.segments ?? [])
  const settings = useEditor((s) => s.doc?.settings)
  const selectedId = useEditor((s) => s.selectedId)
  const jobs = useEditor((s) => s.jobs)
  const [opts, setOpts] = useState<TranscriptionOptions | null>(null)
  const [q, setQ] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [dictOpen, setDictOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api.transcriptionOptions().then(setOpts).catch(() => undefined) }, [])

  const transcribing = Object.values(jobs).find((j) => j.type === 'transcribe' && j.projectId === project?.id && (j.status === 'running' || j.status === 'queued'))
  const video = project?.video
  const filtered = useMemo(() => {
    if (!q.trim()) return segments
    const n = q.trim().toLowerCase()
    return segments.filter((s) => s.text.toLowerCase().includes(n) || (s.sourceText ?? '').toLowerCase().includes(n))
  }, [segments, q])

  // keep selected caption in view
  useEffect(() => {
    if (!selectedId || !listRef.current) return
    listRef.current.querySelector(`[data-seg="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  if (!project || !settings) return null
  const hasUrduSource = segments.some((s) => /[؀-ۿ]/.test(s.sourceText ?? ''))
  const detected = video?.detectedLanguage
  const langLabel = (id?: string | null) => opts?.languages.find((l) => l.id === id)?.label ?? id

  const convert = async (output: 'roman_urdu' | 'urdu_script') => {
    if (!confirm('Convert all captions from their original Urdu transcription? Manual text edits will be replaced (you can undo).')) return
    try {
      await saveNow()
      const p = await api.convertScript(project.id, output)
      useEditor.getState().replaceDocFromServer(p, true)
      toast.success(output === 'roman_urdu' ? 'Converted to Roman Urdu' : 'Converted to Urdu script')
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <MediaCard />
      <div className="px-4 py-3 space-y-3 border-b border-ink-750">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="text-[11px] text-ink-400 flex items-center gap-1"><Languages size={12} /> Spoken language</div>
            <Select value={settings.sourceLanguage} onChange={(v) => useEditor.getState().setSettings({ sourceLanguage: v })} options={opts?.languages ?? LANG_FALLBACK} />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-ink-400">Caption output</div>
            <Select value={settings.outputScript} onChange={(v) => useEditor.getState().setSettings({ outputScript: v })} options={opts?.outputs ?? OUT_FALLBACK} />
          </div>
        </div>
        {detected && (
          <div className="text-[11px] text-ink-400">
            Detected: <span className="text-ink-200">{langLabel(detected)}</span>
            {video?.detectedLanguageProb != null && <span> ({Math.round(video.detectedLanguageProb * 100)}%)</span>}
            {detected === 'hi' && <span className="text-amber-300"> · Urdu speech is often detected as Hindi; choose Urdu if needed.</span>}
          </div>
        )}
        <Button variant="primary" className="w-full" disabled={!video || video.status !== 'ready' || !!transcribing}
          onClick={() => setGenOpen(true)}>
          {segments.length ? <><RefreshCw size={15} /> Regenerate captions</> : <><Sparkles size={15} /> Auto generate captions</>}
        </Button>
        <Button variant="subtle" className="w-full" disabled={!video || video.status !== 'ready' || !!transcribing}
          title="Paste your own transcript (Roman Urdu, Urdu, English…) and sync it to the speech"
          onClick={() => setPasteOpen(true)}>
          <ClipboardPaste size={15} /> Use my own transcript
        </Button>
        {transcribing && <div className="text-[11px] text-accent-300 text-center">{transcribing.stage}… {Math.round(transcribing.progress * 100)}%</div>}
        {hasUrduSource && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="subtle" className="flex-1" onClick={() => convert('roman_urdu')} title="Re-transliterate from the original Urdu transcription"><Wand2 size={13} /> Roman Urdu</Button>
            <Button size="sm" variant="subtle" className="flex-1" onClick={() => convert('urdu_script')}>اردو script</Button>
            <Button size="sm" variant="subtle" onClick={() => setDictOpen(true)} title="Roman Urdu spelling dictionary"><BookA size={13} /></Button>
          </div>
        )}
        {project.transcription?.notes?.length ? (
          <div className="text-[11px] text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">{project.transcription.notes.join(' ')}</div>
        ) : null}
      </div>
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-ink-750">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search captions"
            className="w-full h-8 bg-ink-800 border border-ink-700 rounded-lg pl-8 pr-2 text-xs focus:outline-none focus:border-accent-500" />
        </div>
        <Button size="icon" variant="subtle" title="Add caption at playhead" onClick={() => useEditor.getState().addSegment(useTime.getState().time, 2)}><Plus size={15} /></Button>
      </div>
      <div className="px-4 py-1.5 text-[11px] text-ink-500 flex justify-between">
        <span>{filtered.length}{q ? ` of ${segments.length}` : ''} captions</span>
        <span>AI captions can contain mistakes. Please review.</span>
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-2 pb-4 space-y-1">
        {!segments.length && (
          <div className="text-center text-xs text-ink-500 px-6 py-10 leading-relaxed">
            {video ? 'No captions yet. Click “Auto generate captions”, paste your own transcript with “Use my own transcript”, or add captions manually with +.' : 'Upload a video to get started.'}
          </div>
        )}
        {filtered.map((s) => <CaptionItem key={s.id} seg={s} selected={s.id === selectedId} query={q} />)}
      </div>
      {genOpen && opts && <GenerateDialog opts={opts} onClose={() => setGenOpen(false)} />}
      {pasteOpen && opts && <TranscriptDialog opts={opts} onClose={() => setPasteOpen(false)} />}
      {dictOpen && <DictionaryDialog onClose={() => setDictOpen(false)} />}
    </div>
  )
}

export async function saveNow(label?: string) {
  const st = useEditor.getState()
  if (!st.project || !st.doc) return
  st.setSaveState('saving')
  try {
    await api.saveDocument(st.project.id, { ...st.doc, snapshotLabel: label })
    st.setSaveState('saved')
  } catch (e) {
    st.setSaveState('error', e instanceof Error ? e.message : String(e))
    throw e
  }
}

function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input className="w-[68px] bg-ink-900 border border-ink-700 rounded px-1 py-0.5 text-[11px] font-mono text-ink-200 focus:outline-none focus:border-accent-500"
      value={text ?? formatTime(value)} onFocus={(e) => { setText(formatTime(value)); e.target.select() }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = parseTime(text ?? ''); if (v !== null) onChange(v); setText(null) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation() }}
      onClick={(e) => e.stopPropagation()} />
  )
}

function CaptionItem({ seg, selected, query }: { seg: Segment; selected: boolean; query: string }) {
  const editing = useEditor((s) => s.editingId === seg.id)
  const active = useTime((s) => s.time >= seg.start && s.time < seg.end)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const ed = useEditor.getState

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus()
      const n = taRef.current.value.length
      taRef.current.setSelectionRange(n, n)
    }
  }, [editing])

  const splitAtCursor = () => {
    const ta = taRef.current
    if (ta && editing) {
      const before = ta.value.slice(0, ta.selectionStart)
      ed().split(seg.id, { wordIndex: tokenize(before).length })
    } else {
      const t = useTime.getState().time
      ed().split(seg.id, t > seg.start && t < seg.end ? { time: t } : {})
    }
  }

  const highlight = (text: string) => {
    if (!query.trim()) return text
    const i = text.toLowerCase().indexOf(query.trim().toLowerCase())
    if (i < 0) return text
    return <>{text.slice(0, i)}<mark className="bg-amber-400/40 text-white rounded px-0.5">{text.slice(i, i + query.trim().length)}</mark>{text.slice(i + query.trim().length)}</>
  }

  return (
    <div data-seg={seg.id}
      onClick={() => { ed().select(seg.id); player.seek(seg.start) }}
      onDoubleClick={() => ed().setEditing(seg.id)}
      className={cx('group rounded-xl border px-3 py-2 cursor-pointer transition-colors',
        selected ? 'bg-accent-500/12 border-accent-500/60 bg-[#1d1838]' : active ? 'bg-ink-800 border-ink-600' : 'border-transparent hover:bg-ink-800/70')}>
      <div className="flex items-center gap-1.5 mb-1">
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_6px_#9a82ff]" />}
        {selected ? (
          <div className="flex items-center gap-1">
            <TimeInput value={seg.start} onChange={(v) => ed().setTiming(seg.id, v, Math.max(v + 0.1, seg.end))} />
            <span className="text-ink-500 text-[10px]">→</span>
            <TimeInput value={seg.end} onChange={(v) => ed().setTiming(seg.id, seg.start, Math.max(seg.start + 0.1, v))} />
          </div>
        ) : (
          <span className="text-[11px] font-mono text-ink-500 tabular-nums">{formatTime(seg.start)} – {formatTime(seg.end)}</span>
        )}
        <div className="flex-1" />
        <div className={cx('flex items-center gap-0.5', selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          <IconBtn title="Split (at cursor or playhead)" onClick={splitAtCursor}><Scissors size={12} /></IconBtn>
          <IconBtn title="Merge with next" onClick={() => ed().mergeWithNext(seg.id)}><Merge size={12} /></IconBtn>
          <IconBtn title="Duplicate" onClick={() => ed().duplicateSegment(seg.id)}><Copy size={12} /></IconBtn>
          <IconBtn title="Delete" onClick={() => ed().deleteSegment(seg.id)}><Trash2 size={12} /></IconBtn>
        </div>
      </div>
      {editing ? (
        <textarea ref={taRef} dir="auto" value={seg.text} rows={Math.max(2, Math.ceil(seg.text.length / 34))}
          onChange={(e) => ed().setText(seg.id, e.target.value.replace(/\n/g, ' '))}
          onBlur={() => ed().setEditing(null)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ed().setEditing(null) }
            if (e.key === 'Escape') ed().setEditing(null)
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full resize-none bg-ink-900 border border-accent-500 rounded-lg px-2 py-1.5 text-[13px] text-white leading-snug focus:outline-none" />
      ) : (
        <div dir="auto" className={cx('text-[13px] leading-snug', selected ? 'text-white' : 'text-ink-200')}
          onClick={(e) => { if (selected) { e.stopPropagation(); ed().setEditing(seg.id) } }}>
          {seg.text ? highlight(seg.text) : <span className="text-ink-500 italic">empty caption</span>}
        </div>
      )}
      {selected && seg.sourceText && seg.sourceText !== seg.text && (
        <div dir="auto" className="mt-1 text-[11px] text-ink-500 leading-snug" title="Original transcription">{seg.sourceText}</div>
      )}
    </div>
  )
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button title={title} onClick={(e) => { e.stopPropagation(); onClick() }} className="h-6 w-6 rounded-md inline-flex items-center justify-center text-ink-400 hover:text-white hover:bg-ink-700">
      {children}
    </button>
  )
}
