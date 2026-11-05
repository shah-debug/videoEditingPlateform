import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Italic, Underline, Upload, Type, Palette, Square,
  Move, Sparkles, SlidersHorizontal, LayoutTemplate, AlertTriangle, RotateCcw, Highlighter,
} from 'lucide-react'
import { effectiveStyle, useEditor } from '../editor/store'
import { cssFamily, useFonts, clearMeasureCache } from '../services/fonts'
import { uploadFile } from '../services/api'
import { Button, ColorInput, Field, Section, Segmented, Select, Slider, Toggle, cx, toast } from '../components/ui'
import type { CaptionStyle } from '../types'
import { PresetsSection } from './Presets'
import { displayWords } from '../subtitles/wordSync'
import { isRtl } from '../preview/captionLayout'

const SWATCHES = ['#FFFFFF', '#000000', '#FFD400', '#FF4FD8', '#2BF06B', '#3BA7FF', '#FF5A36', '#7C3AED', '#F5F5F4', '#111827']

export function StylePanel() {
  const doc = useEditor((s) => s.doc)
  const selectedId = useEditor((s) => s.selectedId)
  const scope = useEditor((s) => s.styleScope)
  if (!doc) return null
  const sel = selectedId ? doc.segments.find((s) => s.id === selectedId) ?? null : null
  const style = scope === 'selected' && sel ? effectiveStyle(doc, sel) : doc.style
  const set = (patch: Partial<CaptionStyle>, key?: string) => useEditor.getState().setStyle(patch, key)
  const k = (name: string) => `style-${name}`

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-ink-750 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Caption style</h2>
          {scope === 'selected' && sel?.style && (
            <button className="text-[11px] text-ink-400 hover:text-white inline-flex items-center gap-1" onClick={() => useEditor.getState().clearSegmentStyle(sel.id)}>
              <RotateCcw size={11} /> Reset caption
            </button>
          )}
        </div>
        <Segmented value={sel ? scope : 'all'} onChange={(v) => useEditor.getState().setStyleScope(v)}
          options={[{ id: 'all', label: 'All captions' }, { id: 'selected', label: sel ? 'Selected caption' : 'Select a caption', title: 'Override style for one caption only' }]} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PresetsSection />

        <Section title="Text" icon={<Type size={14} />}>
          <Field label="Text casing">
            <Segmented value={style.textCase} onChange={(v) => set({ textCase: v })}
              options={[{ id: 'none', label: 'Aa' }, { id: 'upper', label: 'AA' }, { id: 'lower', label: 'aa' }, { id: 'title', label: 'Title' }]} />
          </Field>
          <Toggle label="Wrap text onto multiple lines" checked={style.wrap} onChange={(v) => set({ wrap: v })} />
          <Slider label="Maximum lines" min={1} max={5} value={style.maxLines} onChange={(v) => set({ maxLines: v }, k('ml'))}
            format={(v) => String(v)} />
          <Slider label="Max line width" min={0.2} max={1} step={0.01} value={style.maxWidth} onChange={(v) => set({ maxWidth: v }, k('mw'))}
            format={(v) => `${Math.round(v * 100)}%`} />
        </Section>

        <Section title="Font" icon={<Type size={14} />}>
          <FontPicker value={style.fontFamily} onChange={(id) => set({ fontFamily: id })} />
          <FontWarning fontId={style.fontFamily} />
          <Slider label="Font size" min={12} max={200} value={style.fontSize} onChange={(v) => set({ fontSize: v }, k('fs'))} unit="px" />
          <div className="flex gap-2">
            <Select className="flex-1" value={String(style.fontWeight)} onChange={(v) => set({ fontWeight: Number(v) })}
              options={[{ id: '400', label: 'Regular (400)' }, { id: '500', label: 'Medium (500)' }, { id: '600', label: 'Semibold (600)' }, { id: '700', label: 'Bold (700)' }, { id: '800', label: 'Extra bold (800)' }, { id: '900', label: 'Black (900)' }]} />
            <StyleBtn active={style.fontWeight >= 600} title="Bold" onClick={() => set({ fontWeight: style.fontWeight >= 600 ? 400 : 700 })}><Bold size={14} /></StyleBtn>
            <StyleBtn active={style.italic} title="Italic" onClick={() => set({ italic: !style.italic })}><Italic size={14} /></StyleBtn>
            <StyleBtn active={style.underline} title="Underline" onClick={() => set({ underline: !style.underline })}><Underline size={14} /></StyleBtn>
          </div>
          <Slider label="Letter spacing" min={-5} max={30} step={0.5} value={style.letterSpacing} onChange={(v) => set({ letterSpacing: v }, k('ls'))} unit="px" />
          <Slider label="Line height" min={0.8} max={2.5} step={0.05} value={style.lineHeight} onChange={(v) => set({ lineHeight: v }, k('lh'))} format={(v) => v.toFixed(2)} />
        </Section>

        <Section title="Colors" icon={<Palette size={14} />}>
          <ColorInput label="Text color" value={style.textColor} onChange={(v) => set({ textColor: v }, k('tc'))} swatches={SWATCHES} />
          <Slider label="Text opacity" min={0} max={1} step={0.01} value={style.textOpacity} onChange={(v) => set({ textOpacity: v }, k('to'))} format={(v) => `${Math.round(v * 100)}%`} />
          <WordColors />
        </Section>

        <Section title="Background" icon={<Square size={14} />}>
          <Segmented value={!style.backgroundEnabled ? 'none' : style.backgroundOpacity >= 0.999 ? 'solid' : 'semi'}
            onChange={(v) => set(v === 'none' ? { backgroundEnabled: false } : v === 'solid' ? { backgroundEnabled: true, backgroundOpacity: 1 } : { backgroundEnabled: true, backgroundOpacity: style.backgroundOpacity >= 0.999 ? 0.6 : style.backgroundOpacity })}
            options={[{ id: 'none', label: 'None' }, { id: 'solid', label: 'Solid' }, { id: 'semi', label: 'Semi-transparent' }]} />
          {style.backgroundEnabled && <>
            <Field label="Shape">
              <Segmented value={style.backgroundMode} onChange={(v) => set({ backgroundMode: v })}
                options={[{ id: 'block', label: 'One box' }, { id: 'line', label: 'Box per line' }]} />
            </Field>
            <ColorInput label="Background color" value={style.backgroundColor} onChange={(v) => set({ backgroundColor: v }, k('bc'))} swatches={SWATCHES} />
            <Slider label="Opacity" min={0} max={1} step={0.01} value={style.backgroundOpacity} onChange={(v) => set({ backgroundOpacity: v }, k('bo'))} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="grid grid-cols-2 gap-3">
              <Slider label="Padding X" min={0} max={100} value={style.backgroundPaddingX} onChange={(v) => set({ backgroundPaddingX: v }, k('px'))} />
              <Slider label="Padding Y" min={0} max={60} value={style.backgroundPaddingY} onChange={(v) => set({ backgroundPaddingY: v }, k('py'))} />
            </div>
            <Slider label="Corner radius" min={0} max={60} value={style.backgroundRadius} onChange={(v) => set({ backgroundRadius: v }, k('br'))} />
            <Slider label="Box width (0 = fit text)" min={0} max={1} step={0.01} value={style.backgroundWidth} onChange={(v) => set({ backgroundWidth: v }, k('bw'))}
              format={(v) => (v ? `${Math.round(v * 100)}%` : 'Auto')} />
            <Slider label="Min box height" min={0} max={400} value={style.backgroundMinHeight} onChange={(v) => set({ backgroundMinHeight: v }, k('bh'))}
              format={(v) => (v ? `${v}px` : 'Auto')} />
          </>}
        </Section>

        <Section title="Outline & shadow" icon={<SlidersHorizontal size={14} />}>
          <Toggle label="Text outline (stroke)" checked={style.outlineEnabled} onChange={(v) => set({ outlineEnabled: v })} />
          {style.outlineEnabled && <>
            <ColorInput label="Outline color" value={style.outlineColor} onChange={(v) => set({ outlineColor: v }, k('oc'))} swatches={SWATCHES.slice(0, 6)} />
            <Slider label="Outline thickness" min={0.5} max={20} step={0.5} value={style.outlineWidth} onChange={(v) => set({ outlineWidth: v }, k('ow'))} unit="px" />
          </>}
          <div className="h-px bg-ink-750" />
          <Toggle label="Drop shadow" checked={style.shadowEnabled} onChange={(v) => set({ shadowEnabled: v })} />
          {style.shadowEnabled && <>
            <ColorInput label="Shadow color" value={style.shadowColor} onChange={(v) => set({ shadowColor: v }, k('sc'))} swatches={SWATCHES.slice(0, 6)} />
            <Slider label="Shadow opacity" min={0} max={1} step={0.01} value={style.shadowOpacity} onChange={(v) => set({ shadowOpacity: v }, k('so'))} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Shadow blur" min={0} max={40} step={0.5} value={style.shadowBlur} onChange={(v) => set({ shadowBlur: v }, k('sb'))} unit="px" />
            <div className="grid grid-cols-2 gap-3">
              <Slider label="Offset X" min={-30} max={30} step={0.5} value={style.shadowOffsetX} onChange={(v) => set({ shadowOffsetX: v }, k('sx'))} />
              <Slider label="Offset Y" min={-30} max={30} step={0.5} value={style.shadowOffsetY} onChange={(v) => set({ shadowOffsetY: v }, k('sy'))} />
            </div>
          </>}
        </Section>

        <Section title="Position & alignment" icon={<Move size={14} />}>
          <div className="grid grid-cols-3 gap-1.5">
            {([['top', 'Top'], ['top-center', 'Upper'], ['center', 'Center'], ['bottom-center', 'Lower'], ['bottom', 'Bottom'], ['custom', 'Custom']] as const).map(([id, label]) => (
              <button key={id} onClick={() => set(id === 'custom' ? { position: 'custom' } : { position: id, x: 0.5 })}
                className={cx('h-8 rounded-lg text-[11px] border', style.position === id ? 'bg-accent-500/20 border-accent-500 text-white' : 'border-ink-700 text-ink-400 hover:text-white hover:border-ink-500')}>
                {label}
              </button>
            ))}
          </div>
          <Field label="Text alignment">
            <Segmented value={style.align} onChange={(v) => set({ align: v })}
              options={[{ id: 'left', label: <AlignLeft size={14} /> }, { id: 'center', label: <AlignCenter size={14} /> }, { id: 'right', label: <AlignRight size={14} /> }]} />
          </Field>
          <Slider label="X position" min={0} max={1} step={0.005} value={style.x} onChange={(v) => set({ x: v, position: 'custom' }, k('x'))} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Y position" min={0} max={1} step={0.005} value={style.y} onChange={(v) => set({ y: v, position: 'custom' }, k('y'))} format={(v) => `${Math.round(v * 100)}%`} />
          <p className="text-[11px] text-ink-500">Tip: drag the caption directly on the video. It snaps to the centre.</p>
        </Section>

        <Section title="Animation & word highlight" icon={<Sparkles size={14} />}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="In">
              <Select value={style.animationIn} onChange={(v) => set({ animationIn: v as CaptionStyle['animationIn'] })}
                options={[{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade in' }, { id: 'pop', label: 'Pop in' }, { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' }]} />
            </Field>
            <Field label="Out">
              <Select value={style.animationOut} onChange={(v) => set({ animationOut: v as CaptionStyle['animationOut'] })}
                options={[{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade out' }]} />
            </Field>
          </div>
          {(style.animationIn !== 'none' || style.animationOut !== 'none') && (
            <Slider label="Animation duration" min={0.05} max={1} step={0.05} value={style.animationDuration} onChange={(v) => set({ animationDuration: v }, k('ad'))} format={(v) => `${v.toFixed(2)}s`} />
          )}
          <Field label="Word-level mode">
            <Select value={style.wordMode} onChange={(v) => set({ wordMode: v as CaptionStyle['wordMode'] })}
              options={[{ id: 'none', label: 'Off' }, { id: 'highlight', label: 'Highlight active word' }, { id: 'karaoke', label: 'Karaoke fill' },
                { id: 'reveal', label: 'Word-by-word appearance' }, { id: 'reveal-highlight', label: 'Word-by-word + highlight' }]} />
          </Field>
          {style.wordMode !== 'none' && style.wordMode !== 'reveal' && (
            <ColorInput label="Active word color" value={style.activeWordColor} onChange={(v) => set({ activeWordColor: v }, k('aw'))} swatches={SWATCHES} />
          )}
          {style.wordMode !== 'none' && <p className="text-[11px] text-ink-500">Uses the real per-word timestamps from the audio.</p>}
        </Section>
      </div>
    </div>
  )
}

function StyleBtn({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <button title={title} onClick={onClick} className={cx('h-8 w-8 rounded-lg border inline-flex items-center justify-center',
      active ? 'bg-accent-500/25 border-accent-500 text-white' : 'border-ink-700 text-ink-400 hover:text-white')}>{children}</button>
  )
}

function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { list, fonts, ensure, init } = useFonts()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    list.forEach((f) => ensure(f.id))
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open, list, ensure])
  const cur = fonts[value]

  const upload = async (f: File) => {
    try {
      const info = await uploadFile(`/api/fonts/upload?filename=${encodeURIComponent(f.name)}`, f, () => undefined).promise
      await init()
      clearMeasureCache()
      onChange(info.id)
      toast.success(`Font “${info.family}” added`)
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="w-full h-9 flex items-center gap-2 bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm hover:border-ink-500">
        <span className="flex-1 text-left truncate text-white" style={{ fontFamily: `"${cssFamily(value)}"` }}>{cur?.label ?? value}</span>
        <ChevronDown size={14} className="text-ink-500" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto bg-ink-850 border border-ink-700 rounded-xl shadow-2xl p-1 anim-in">
          {list.map((f) => (
            <button key={f.id} onClick={() => { onChange(f.id); setOpen(false) }}
              className={cx('w-full text-left px-3 py-2 rounded-lg hover:bg-ink-750 flex items-center gap-2', f.id === value && 'bg-accent-500/15')}>
              <span className="flex-1 text-[15px] text-white truncate" style={{ fontFamily: `"${cssFamily(f.id)}"` }}>{f.label}</span>
              {f.supportsArabic && <span className="text-[10px] px-1.5 rounded bg-emerald-500/15 text-emerald-300" style={{ fontFamily: `"${cssFamily(f.id)}"` }}>اردو</span>}
              {f.source === 'user' && <span className="text-[10px] text-ink-500">custom</span>}
            </button>
          ))}
          <div className="border-t border-ink-750 mt-1 pt-1">
            <button onClick={() => file.current?.click()} className="w-full text-left px-3 py-2 rounded-lg hover:bg-ink-750 text-xs text-accent-300 inline-flex items-center gap-2">
              <Upload size={13} /> Upload custom font (.ttf / .otf)
            </button>
          </div>
        </div>
      )}
      <input ref={file} type="file" accept=".ttf,.otf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
    </div>
  )
}

function FontWarning({ fontId }: { fontId: string }) {
  const fonts = useFonts((s) => s.fonts)
  const hasUrdu = useEditor((s) => s.doc?.segments.some((g) => isRtl(g.text)) ?? false)
  const f = fonts[fontId]
  if (!f || !hasUrdu || f.supportsArabic) return null
  return (
    <div className="flex gap-2 text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>This font has no Urdu letters. Use <b>Gulzar</b>, <b>Lateef</b>, Arial, Segoe UI or Tahoma for Urdu script.</span>
    </div>
  )
}

function WordColors() {
  const doc = useEditor((s) => s.doc)!
  const selectedId = useEditor((s) => s.selectedId)
  const [paint, setPaint] = useState('#FFD400')
  const seg = selectedId ? doc.segments.find((s) => s.id === selectedId) : null
  const words = useMemo(() => (seg ? displayWords(seg) : []), [seg])
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5 text-xs text-ink-300"><Highlighter size={13} /> Color individual words</div>
      {!seg ? <p className="text-[11px] text-ink-500">Select a caption, then click words to paint them (e.g. make “Lahore” yellow).</p> : <>
        <ColorInput value={paint} onChange={setPaint} swatches={SWATCHES.slice(2, 8)} />
        <div className="flex flex-wrap gap-1 p-2 rounded-lg bg-ink-900 border border-ink-750" dir="auto">
          {words.map((w, i) => (
            <button key={i} onClick={() => useEditor.getState().setWordColor(seg.id, i, w.color?.toUpperCase() === paint.toUpperCase() ? null : paint)}
              title={w.color ? 'Click to reset' : 'Click to paint'}
              className="px-1.5 py-0.5 rounded-md text-[12px] border border-ink-700 hover:border-ink-400"
              style={{ color: w.color || doc.style.textColor, background: '#0b0c10' }}>{w.text}</button>
          ))}
        </div>
        {words.some((w) => w.color) && <Button size="sm" variant="ghost" onClick={() => words.forEach((_, i) => useEditor.getState().setWordColor(seg.id, i, null))}>Clear word colors</Button>}
      </>}
    </div>
  )
}

export { LayoutTemplate }
