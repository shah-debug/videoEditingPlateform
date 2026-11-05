import { useEffect, useState } from 'react'
import { LayoutTemplate, Save, Trash2 } from 'lucide-react'
import { useEditor } from '../editor/store'
import { api } from '../services/api'
import { cssFamily, useFonts } from '../services/fonts'
import { Section, cx, toast } from '../components/ui'
import type { CaptionStyle, Preset } from '../types'

// style keys a preset controls (never text/timing)
const PRESET_KEYS: (keyof CaptionStyle)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'italic', 'underline', 'letterSpacing', 'lineHeight', 'textCase', 'wrap',
  'textColor', 'textOpacity', 'outlineEnabled', 'outlineColor', 'outlineWidth', 'shadowEnabled', 'shadowColor',
  'shadowOpacity', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'backgroundEnabled', 'backgroundMode',
  'backgroundColor', 'backgroundOpacity', 'backgroundPaddingX', 'backgroundPaddingY', 'backgroundRadius',
  'backgroundWidth', 'backgroundMinHeight', 'position', 'x', 'y', 'align', 'maxWidth', 'maxLines', 'animationIn',
  'animationOut', 'animationDuration', 'wordMode', 'activeWordColor',
]

export function PresetsSection() {
  const [presets, setPresets] = useState<Preset[]>([])
  const style = useEditor((s) => s.doc?.style)
  const ensure = useFonts((s) => s.ensure)
  const load = () => api.presets().then((p) => { setPresets(p); p.forEach((x) => x.style.fontFamily && ensure(x.style.fontFamily)) }).catch(() => undefined)
  useEffect(() => { load() }, [])

  const save = async () => {
    const name = prompt('Name for this preset:')
    if (!name?.trim() || !style) return
    const s: Partial<CaptionStyle> = {}
    PRESET_KEYS.forEach((k) => ((s as any)[k] = style[k]))
    try { await api.createPreset(name.trim(), s); toast.success('Preset saved'); load() } catch (e) { toast.error(e) }
  }

  return (
    <Section title="Presets" icon={<LayoutTemplate size={14} />}
      right={<span role="button" title="Save current style as preset" onClick={(e) => { e.stopPropagation(); save() }} className="text-ink-400 hover:text-white mr-1"><Save size={14} /></span>}>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <div key={p.id} className="relative group">
            <button onClick={() => { useEditor.getState().applyPreset(p.style); toast.info(`Applied “${p.name}”`) }}
              className="w-full h-[68px] rounded-xl border border-ink-700 hover:border-accent-500 bg-[linear-gradient(135deg,#2a2f3a,#16181f)] overflow-hidden flex flex-col items-center justify-center gap-1 px-1">
              <PresetSample s={p.style} />
              <span className="text-[10px] text-ink-400 truncate max-w-full">{p.name}</span>
            </button>
            {!p.builtin && (
              <button title="Delete preset" onClick={async () => { await api.deletePreset(p.id); load() }}
                className="absolute top-1 right-1 h-5 w-5 rounded bg-black/60 text-ink-300 hover:text-red-300 hidden group-hover:flex items-center justify-center"><Trash2 size={11} /></button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-ink-500">Presets change styling only: your text and timing stay as they are.</p>
    </Section>
  )
}

function PresetSample({ s }: { s: Partial<CaptionStyle> }) {
  const text = s.textCase === 'upper' ? 'LAHORE JAUNGA' : 'Lahore jaunga'
  const hl = s.wordMode && s.wordMode !== 'none' && s.wordMode !== 'reveal'
  return (
    <span className={cx('text-[13px] leading-none px-1.5 py-1 rounded max-w-full truncate')}
      style={{
        fontFamily: `"${cssFamily(s.fontFamily ?? 'poppins')}"`,
        fontWeight: (s.fontWeight ?? 700) >= 600 ? 700 : 400,
        fontStyle: s.italic ? 'italic' : 'normal',
        color: s.textColor ?? '#fff',
        background: s.backgroundEnabled ? hexA(s.backgroundColor ?? '#000', s.backgroundOpacity ?? 0.7) : 'transparent',
        WebkitTextStroke: s.outlineEnabled ? `${Math.min(2, (s.outlineWidth ?? 2) / 2.5)}px ${s.outlineColor ?? '#000'}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: s.shadowEnabled ? `0 1px 3px ${hexA(s.shadowColor ?? '#000', s.shadowOpacity ?? 0.6)}` : undefined,
      }}>
      {hl ? <><span style={{ color: s.activeWordColor }}>{text.split(' ')[0]}</span> {text.split(' ')[1]}</> : text}
    </span>
  )
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
