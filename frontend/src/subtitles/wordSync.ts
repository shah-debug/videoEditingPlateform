import type { Segment, Word } from '../types'

export const tokenize = (text: string) => text.trim().split(/\s+/).filter(Boolean)
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Keep word timestamps aligned with edited caption text.
 * Unchanged words keep their real audio timing (LCS match); inserted words get times interpolated between
 * their matched neighbours. So editing a word or fixing spelling doesn't destroy word-level highlighting.
 */
export function resyncWords(old: Word[], text: string, start: number, end: number): Word[] {
  const toks = tokenize(text)
  if (!toks.length) return []
  if (old.length === toks.length) return old.map((w, i) => ({ ...w, text: toks[i] }))
  if (!old.length) return evenWords(toks, start, end)

  // LCS on normalised tokens
  const a = old.map((w) => norm(w.text)), b = toks.map(norm)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] && a[i] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const match: (number | null)[] = new Array(b.length).fill(null)
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j] && a[i]) { match[j] = i; i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  // positional fallback when nothing matched (e.g. whole sentence rewritten in another script)
  if (match.every((m) => m === null)) return evenWords(toks, start, end, old)

  const out: Word[] = toks.map((t, k) => (match[k] !== null ? { ...old[match[k]!], text: t } : { text: t, start: 0, end: 0 }))
  let k = 0
  while (k < out.length) {
    if (match[k] !== null) { k++; continue }
    let e = k
    while (e < out.length && match[e] === null) e++
    let from = k
    let lo = k > 0 ? out[k - 1].end : start
    const hi = e < out.length ? out[e].start : end
    // No room between the neighbours (e.g. words typed after the last word): share the previous word's
    // time with the new words instead of squeezing them into a zero-length slot.
    if (hi - lo < 0.12 * (e - k) && k > 0) { from = k - 1; lo = out[k - 1].start }
    spread(out, from, e, lo, Math.max(lo + 0.04 * (e - from), hi))
    k = e
  }
  return out
}

/** Spread words[from..to) over [lo, hi] in proportion to their length. */
function spread(words: Word[], from: number, to: number, lo: number, hi: number) {
  const total = words.slice(from, to).reduce((s, w) => s + Math.max(1, w.text.length), 0)
  let t = lo
  for (let q = from; q < to; q++) {
    const d = ((hi - lo) * Math.max(1, words[q].text.length)) / total
    words[q] = { ...words[q], start: t, end: t + d }
    t += d
  }
}

/** Word timings that can't be right (overlapping, ~0 length or outside the caption), e.g. from captions edited
 * by older versions. Such words are re-spread evenly. Mirrors timings_broken() in subtitle_formats.py. */
export function wordsLookBroken(words: Word[], start: number, end: number): boolean {
  const tol = 0.1
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.end - w.start < 0.02 || w.start < start - tol || w.end > end + tol) return true
    if (i > 0 && w.start < words[i - 1].end - 0.01) return true
  }
  return false
}

export function evenWords(toks: string[], start: number, end: number, colorsFrom?: Word[]): Word[] {
  const total = toks.reduce((s, t) => s + Math.max(1, t.length), 0)
  let t = start
  return toks.map((tok, i) => {
    const d = ((end - start) * Math.max(1, tok.length)) / total
    const w: Word = { text: tok, start: t, end: t + d, color: colorsFrom?.[i]?.color ?? null }
    t += d
    return w
  })
}

/** Words aligned 1:1 with caption tokens (same rule as display_words() on the backend). */
export function displayWords(seg: Segment): Word[] {
  const toks = tokenize(seg.text)
  if (seg.words.length === toks.length && !wordsLookBroken(seg.words, seg.start, seg.end))
    return seg.words.map((w, i) => ({ ...w, text: toks[i] }))
  return evenWords(toks, seg.start, seg.end, seg.words)
}

export function newId() {
  return 'cap_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6)
}

/** Split at time t (or at a word index). */
export function splitSegment(seg: Segment, at: { time?: number; wordIndex?: number }): [Segment, Segment] | null {
  const words = displayWords(seg)
  let idx: number
  if (at.wordIndex !== undefined) idx = at.wordIndex
  else {
    const t = at.time ?? (seg.start + seg.end) / 2
    idx = words.findIndex((w) => (w.start + w.end) / 2 >= t)
    if (idx < 0) idx = words.length
  }
  if (words.length >= 2) idx = Math.min(Math.max(idx, 1), words.length - 1)
  else if (words.length < 2) {
    // single word / empty: split time only
    const t = at.time ?? (seg.start + seg.end) / 2
    if (t - seg.start < 0.1 || seg.end - t < 0.1) return null
    return [{ ...seg, end: t }, { ...seg, id: newId(), start: t, text: seg.text, words: [] }]
  }
  const left = words.slice(0, idx), right = words.slice(idx)
  const cut = at.time !== undefined && at.time > left[left.length - 1].start && at.time < right[0].end
    ? at.time
    : (left[left.length - 1].end + right[0].start) / 2
  const srcToks = seg.sourceText ? tokenize(seg.sourceText) : null
  const srcSplit = srcToks && srcToks.length === words.length
  return [
    { ...seg, end: Math.max(seg.start + 0.05, cut), text: left.map((w) => w.text).join(' '), words: left,
      sourceText: srcSplit ? srcToks!.slice(0, idx).join(' ') : seg.sourceText },
    { ...seg, id: newId(), start: Math.min(seg.end - 0.05, cut), text: right.map((w) => w.text).join(' '), words: right,
      sourceText: srcSplit ? srcToks!.slice(idx).join(' ') : null },
  ]
}

export function mergeSegments(a: Segment, b: Segment): Segment {
  const [x, y] = a.start <= b.start ? [a, b] : [b, a]
  return {
    ...x,
    start: Math.min(x.start, y.start),
    end: Math.max(x.end, y.end),
    text: `${x.text} ${y.text}`.trim(),
    sourceText: x.sourceText || y.sourceText ? `${x.sourceText ?? ''} ${y.sourceText ?? ''}`.trim() : null,
    words: [...displayWords(x), ...displayWords(y)],
  }
}

/** Shift a segment (and its word timings) by dt. */
export function shiftSegment(seg: Segment, dt: number): Segment {
  return { ...seg, start: seg.start + dt, end: seg.end + dt, words: seg.words.map((w) => ({ ...w, start: w.start + dt, end: w.end + dt })) }
}

/** Change start/end; word timings are clamped (or rescaled when stretching/shrinking). */
export function retimeSegment(seg: Segment, start: number, end: number): Segment {
  if (end - start < 0.05) end = start + 0.05
  const oldD = seg.end - seg.start || 1
  const k = (end - start) / oldD
  const words = seg.words.map((w) => ({ ...w, start: start + (w.start - seg.start) * k, end: start + (w.end - seg.start) * k }))
  return { ...seg, start, end, words }
}
