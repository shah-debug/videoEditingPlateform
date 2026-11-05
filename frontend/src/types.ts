// Mirrors backend/app/schemas/style.py (DEFAULT_STYLE) — keep in sync.
export type TextCase = 'none' | 'upper' | 'lower' | 'title'
export type Align = 'left' | 'center' | 'right'
export type PositionPreset = 'top' | 'top-center' | 'center' | 'bottom-center' | 'bottom' | 'custom'
export type AnimIn = 'none' | 'fade' | 'pop' | 'slide-up' | 'slide-down'
export type AnimOut = 'none' | 'fade'
export type WordMode = 'none' | 'highlight' | 'karaoke' | 'reveal' | 'reveal-highlight'

export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  underline: boolean
  letterSpacing: number
  lineHeight: number
  textCase: TextCase
  wrap: boolean
  textColor: string
  textOpacity: number
  outlineEnabled: boolean
  outlineColor: string
  outlineWidth: number
  shadowEnabled: boolean
  shadowColor: string
  shadowOpacity: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  backgroundEnabled: boolean
  backgroundMode: 'block' | 'line'
  backgroundColor: string
  backgroundOpacity: number
  backgroundPaddingX: number
  backgroundPaddingY: number
  backgroundRadius: number
  backgroundWidth: number
  backgroundMinHeight: number
  position: PositionPreset
  x: number
  y: number
  align: Align
  maxWidth: number
  maxLines: number
  animationIn: AnimIn
  animationOut: AnimOut
  animationDuration: number
  wordMode: WordMode
  activeWordColor: string
}

export const POSITION_Y: Record<Exclude<PositionPreset, 'custom'>, number> = {
  top: 0.12, 'top-center': 0.3, center: 0.5, 'bottom-center': 0.7, bottom: 0.85,
}

export interface Word {
  text: string
  start: number
  end: number
  sourceText?: string | null
  probability?: number | null
  color?: string | null
}

export interface Segment {
  id: string
  start: number
  end: number
  text: string
  sourceText?: string | null
  speaker?: string | null
  style?: Partial<CaptionStyle> | null
  words: Word[]
}

export interface Settings {
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1' | '4:5'
  fitMode: 'fit' | 'fill'
  padColor: string
  sourceLanguage: string
  outputScript: string
  model: string | null
  captionLength: string
  /** preset last applied from the Presets panel (shown as selected / edited) */
  presetId?: string | null
}

export interface VideoMeta {
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  hasAudio: boolean
  sizeBytes: number
  format: string
  container: string
  bitrate: number
}

export interface Video {
  id: string
  originalFilename: string
  sizeBytes: number
  meta: VideoMeta | Record<string, never>
  status: 'uploaded' | 'processing' | 'ready' | 'error'
  error: string | null
  detectedLanguage: string | null
  detectedLanguageProb: number | null
  hasProxy: boolean
  hasWaveform: boolean
  streamUrl: string
  originalUrl: string
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  settings: Settings
  style: CaptionStyle
  transcription: {
    language?: string
    languageProbability?: number
    output?: string
    model?: string
    notes?: string[]
    detected?: { language: string; probability: number } | null
  }
  video: Video | null
  segments?: Segment[]
  segmentCount?: number
}

export interface Job {
  id: string
  projectId: string | null
  type: 'process' | 'transcribe' | 'export'
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  stage: string
  message: string
  params?: Record<string, unknown>
  result?: Record<string, any>
  error?: string | null
}

export interface FontInfo {
  id: string
  label: string
  family: string
  variants: string[]
  upem: number
  ascent: number
  descent: number
  supportsArabic: boolean
  supportsLatin: boolean
  source: 'system' | 'bundled' | 'user'
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  style: Partial<CaptionStyle>
}

export interface Option { id: string; label: string }

export interface TranscriptionOptions {
  languages: Option[]
  outputs: Option[]
  models: (Option & { sizeMB: number; downloaded: boolean })[]
  defaultModel: string
  captionLengths: Option[]
  whisperx: boolean
}
