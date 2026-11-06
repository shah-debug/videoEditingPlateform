import { useOwnerWindow } from '../editor/PopoutWindow'
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { ChevronDown, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Button({ children, onClick, variant = 'ghost', size = 'md', disabled, title, className, type = 'button' }: {
  children: ReactNode; onClick?: (e: React.MouseEvent) => void; variant?: 'primary' | 'ghost' | 'subtle' | 'danger'
  size?: 'sm' | 'md' | 'icon'; disabled?: boolean; title?: string; className?: string; type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors select-none disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'icon' && 'h-8 w-8 text-sm',
        variant === 'primary' && 'bg-accent-500 hover:bg-accent-600 text-white shadow-[0_2px_12px_-2px_rgba(124,92,255,.6)]',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-750 hover:text-white',
        variant === 'subtle' && 'bg-ink-750 hover:bg-ink-700 text-ink-200 border border-ink-700',
        variant === 'danger' && 'bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/30',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Section({ title, icon, children, defaultOpen = true, right }: {
  title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-ink-750">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 text-[13px] font-semibold text-ink-200 hover:text-white">
        <span className="text-ink-400">{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        {right}
        <ChevronDown size={15} className={cx('text-ink-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3 anim-in">{children}</div>}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-ink-400"><span title={hint}>{label}</span></div>
      {children}
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, unit = '', format }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string
  format?: (v: number) => string
}) {
  const fill = ((value - min) / (max - min)) * 100
  const [text, setText] = useState<string | null>(null)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-400">{label}</span>
        <input
          className="w-16 bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-right text-ink-200 text-xs focus:outline-none focus:border-accent-500"
          value={text ?? (format ? format(value) : `${+value.toFixed(3)}${unit}`)}
          onFocus={() => setText(String(+value.toFixed(3)))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(text ?? '')
            if (!isNaN(v)) onChange(Math.min(max * 4, Math.max(min, v)))
            setText(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        style={{ ['--fill' as any]: `${Math.max(0, Math.min(100, fill))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

export function ColorInput({ label, value, onChange, swatches }: {
  label?: string; value: string; onChange: (v: string) => void; swatches?: string[]
}) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  return (
    <div className="space-y-1.5">
      {label && <div className="text-xs text-ink-400">{label}</div>}
      <div className="flex items-center gap-2">
        <input type="color" className="swatch" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input
          className="flex-1 min-w-0 bg-ink-800 border border-ink-700 rounded-md px-2 h-7 text-xs font-mono uppercase text-ink-200 focus:outline-none focus:border-accent-500"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value)
            if (HEX_RE.test(e.target.value)) onChange(('#' + e.target.value.replace('#', '')).toUpperCase())
          }}
          onBlur={() => setHex(value)}
          maxLength={7}
        />
      </div>
      {swatches && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {swatches.map((c) => (
            <button key={c} title={c} onClick={() => onChange(c)} className={cx('h-5 w-5 rounded-md border', value.toUpperCase() === c ? 'border-white ring-2 ring-accent-500' : 'border-ink-600')} style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none" title={hint}>
      <span className="text-xs text-ink-300">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative block h-5 w-9 shrink-0 rounded-full p-0 transition-colors', checked ? 'bg-accent-500' : 'bg-ink-600')}>
        <span className={cx('absolute left-0.5 top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'
}) {
  return (
    <div className="flex rounded-lg bg-ink-800 p-0.5 border border-ink-700">
      {options.map((o) => (
        <button key={o.id} title={o.title} onClick={() => onChange(o.id)}
          className={cx('flex-1 inline-flex items-center justify-center rounded-md transition-colors', size === 'sm' ? 'h-6 text-[11px]' : 'h-7 text-xs',
            value === o.id ? 'bg-ink-650 bg-ink-600 text-white shadow' : 'text-ink-400 hover:text-ink-200')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, onChange, options, className }: {
  value: string; onChange: (v: string) => void; options: { id: string; label: string }[]; className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-ink-800 border border-ink-700 rounded-lg h-8 pl-2.5 pr-7 text-xs text-ink-200 focus:outline-none focus:border-accent-500 cursor-pointer">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 520, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number; footer?: ReactNode
}) {
  const win = useOwnerWindow()
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    win.addEventListener('keydown', h)
    return () => win.removeEventListener('keydown', h)
  }, [open, onClose, win])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div className="bg-ink-850 border border-ink-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col anim-in" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center px-5 py-4 border-b border-ink-750">
          <h3 className="flex-1 text-[15px] font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-ink-750 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('h-1.5 rounded-full bg-ink-700 overflow-hidden', className)}>
      <div className="h-full bg-gradient-to-r from-accent-500 to-fuchsia-500 transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

// ---------------------------------------------------------------- toasts
interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }
export const useToasts = create<{ items: Toast[]; push: (kind: Toast['kind'], text: string) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items.slice(-3), { id, kind, text }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 3500)
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))
export const toast = {
  info: (t: string) => useToasts.getState().push('info', t),
  error: (t: unknown) => useToasts.getState().push('error', t instanceof Error ? t.message : String(t)),
  success: (t: string) => useToasts.getState().push('success', t),
}

export function Toasts() {
  const { items, remove } = useToasts()
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-80">
      {items.map((t) => (
        <div key={t.id} onClick={() => remove(t.id)} className={cx('anim-in cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur',
          t.kind === 'error' && 'bg-red-950/90 border-red-800 text-red-100',
          t.kind === 'success' && 'bg-emerald-950/90 border-emerald-800 text-emerald-100',
          t.kind === 'info' && 'bg-ink-800/95 border-ink-600 text-ink-100')}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded bg-ink-700 border border-ink-600 text-[10px] font-mono text-ink-300">{children}</kbd>
}
