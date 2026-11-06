# AI Caption Studio

A local, Kapwing-style AI caption editor. Upload a video → it is transcribed on your own computer with
Faster-Whisper → edit, style and time the captions on a visual timeline → export an MP4 with the captions burned
in (plus SRT / VTT / ASS).

Built for **Urdu speech with Roman Urdu captions**, English, and 30+ other languages. The original video is never
modified. Only captions are added.

```
Python (FastAPI · Faster-Whisper · FFmpeg/libass · SQLite · WebSockets)  +  React · TypeScript · Tailwind
```

---

## Quick start (Windows)

Requirements: **Python 3.11+**, **Node.js 18+**, **FFmpeg full build** (with libass, libx264, libx265) on PATH.

```bat
winget install Gyan.FFmpeg        :: if you don't have FFmpeg yet
setup.bat                          :: creates backend\.venv, installs deps, builds the frontend
start.bat                          :: starts the app and opens http://127.0.0.1:8000
```

The first caption generation downloads the selected Whisper model once (small ≈ 480 MB, large-v3-turbo ≈ 1.6 GB)
into `data/models`. After that everything runs offline.

### Manual setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python run.py                # http://127.0.0.1:8000  (serves frontend/dist if built)

cd ../frontend
npm install
npm run build                             # production build served by the backend
npm run dev                               # or: hot-reload dev UI on http://localhost:5173 (proxies /api)
```

Configuration is optional: copy `.env.example` to `.env`.

---

## Features

| Area | What you get |
|---|---|
| Upload | Drag & drop / file picker, MP4 · MOV · AVI · MKV · WEBM. Streaming upload (the browser never loads the file into memory; the server writes chunks to disk). Instant local preview while uploading. Replace / remove video. Metadata: duration, resolution, fps, size, container and codecs. |
| Processing | FFprobe metadata + validation (corrupt/unsupported files get a clear message), 16 kHz audio extraction, waveform, automatic H.264 preview proxy for formats browsers can't play (HEVC, AVI, 10-bit…), automatic language detection. |
| AI captions | Faster-Whisper with Silero VAD, word-level timestamps, auto/manual language, model choice (tiny → large-v3), caption length (short/social, medium, long). Separate *spoken language* and *caption output*: **Original**, **Roman Urdu**, **Urdu script**, **English translation**. |
| Your own transcript | **Use my own transcript**: paste (or open a .txt/.srt/.vtt) the exact words in Roman Urdu, Urdu script or any language. The app finds when each word is spoken and builds the captions, either fitted to the screen automatically or one caption per line you typed. Your spelling is kept exactly. Works even where the speech model mishears words. |
| Roman Urdu | Urdu is transcribed in Urdu script first, then transliterated word by word (no translation). Contextual rules, lexicon, morphology, English code-switch detection, your own spelling dictionary. Switch Urdu script ↔ Roman Urdu at any time without re-transcribing. |
| Caption panel | The setup area (video, language, generate) collapses with one click. The panel opens in its own window (where the whole panel scrolls, not only the list) (button, or drag its grip out of the browser window) to put it full-width on a second screen; both windows stay in sync, closing it docks the panel back. |
| Editing | Click to select & seek, double-click/Enter to edit, add, delete, duplicate, split (at text cursor or playhead), merge, exact start/end inputs, search. Word timings are kept when you edit text (unchanged words keep their real audio timing). |
| Styling | Font family (incl. Urdu Nastaliq/Naskh fonts), custom font upload, size, weight, bold/italic/underline, letter spacing, line height, casing, wrapping, max lines, max width. Text colour + HEX + opacity, per-word colours. Background: none/solid/semi-transparent, colour, opacity, padding, corner radius, width, min height, one box or box per line. Outline colour/thickness. Shadow colour/opacity/blur/offset. Position presets, X/Y, drag on the video with centre snapping, left/centre/right alignment. |
| Animation | Fade in/out, pop in, slide up/down (all off by default). Word modes: highlight active word, karaoke fill, word-by-word appearance, word-by-word + highlight, all driven by the real word timestamps. |
| Presets | 10 built-in presets (Classic White, Bold White on Black, Yellow Highlight, Minimal Clean, Social Media, TikTok, YouTube Shorts, Podcast, Cinematic, Word-by-Word). Save/reuse your own. The preset matching the current style is marked selected (✓); one you applied and then changed is marked *Edited*. Presets never touch text or timing. |
| Timeline | Time ruler, audio waveform, caption blocks. Drag a box over empty space in the captions row to select several captions; double-click a caption or empty space (or Ctrl+A) selects all, Ctrl+click adds one, Shift+click selects a range; drag any selected caption to move the whole selection, Delete removes it. Drag to move, drag edges to resize (no overlaps), click/drag to scrub, Ctrl+wheel zoom, fit, auto-follow playhead, split/merge/delete/add toolbar. Selection is synced with the caption list. |
| Preview | Original video in the chosen aspect ratio (Original, 16:9, 9:16, 1:1, 4:5) with Fit (bars, custom colour) or Fill (crop), zoom, fullscreen. Captions are drawn in their exact export position. |
| Export | MP4 (H.264, high quality), Original/720p/1080p/4K, original/24/25/30/60 fps, burned-in captions on/off, live progress, cancel, in-app preview of the rendered file, download; the file is also kept in `backend/exports/`. |
| Projects | Create, rename, delete, reopen; everything auto-saves to SQLite (debounced) and Ctrl+S creates a named restore point. Restore points are also made automatically before regenerating/converting. |
| History | Undo/redo for text, styling, timeline moves and deletions (Ctrl+Z / Ctrl+Shift+Z). Slider drags are grouped into one undo step. |

### Keyboard shortcuts

`Space` play/pause · `Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · `Ctrl+S` save · `Delete` delete caption ·
`Ctrl+A` select all captions · `Enter` edit caption · `S` split at playhead · `←/→` step · `Shift+←/→` ±5 s · `Ctrl+wheel` timeline zoom · `Esc` deselect

---

## How it works

### Architecture

```
frontend (React/TS)                          backend (FastAPI)
┌──────────────────────────┐   REST + WS    ┌──────────────────────────────────────────────┐
│ Editor store (zustand)   │ ─────────────▶ │ api/          projects, videos, transcription │
│  undo/redo doc snapshots │                │               subtitles, export, presets, ws  │
│ VideoPreview + overlay   │ ◀── progress ─ │ workers/      thread-pool jobs + WS hub       │
│ captionLayout.ts  ◀══════╪══ same algo ══╪▶ services/caption_layout.py                   │
│ Timeline (canvas+DOM)    │                │ services/     transcription, transliteration, │
│ Style / Presets panels   │                │               subtitle_alignment, ffmpeg_…    │
└──────────────────────────┘                │ SQLite (projects, segments, words, jobs, …)   │
                                            └──────────────────────────────────────────────┘
```

```
backend/app/
  main.py                     app, startup (DB, presets, temp cleanup), static frontend
  config.py  db.py            settings, SQLAlchemy engine
  models/                     projects, videos, segments, words, jobs, presets, history, dictionary, fonts
  schemas/style.py            caption style model + built-in presets
  api/                        REST endpoints + WebSocket
  services/
    video_processing.py       ffprobe, audio extraction, waveform, preview proxy
    transcription.py          Faster-Whisper (model cache, VAD, word timestamps, language ID)
    subtitle_alignment.py     timing clean-up, optional WhisperX alignment, caption segmentation
    transliteration.py        Urdu → Roman Urdu (+ urdu_lexicon.py, urdu_lexicon_extra.py, english_loanwords.py)
    transcript_align.py       sync a pasted transcript to the speech (phonetic matching + alignment)
    caption_layout.py         line wrapping / box geometry (mirrors frontend/src/preview/captionLayout.ts)
    subtitle_formats.py       SRT / VTT / ASS writers (ASS = styled burn-in script)
    ffmpeg_renderer.py        final render
    fonts.py                  font catalog, metrics, HarfBuzz measurement
    project_service.py        persistence helpers
  workers/                    job manager + job implementations
frontend/src/
  editor/ subtitles/ preview/ settings/ timeline/ export/ home/ services/ components/
```

### Urdu transcription → Roman Urdu

1. **Transcribe in Urdu script.** Faster-Whisper runs with `language="ur"`, an Urdu-script prompt (keeps Urdu letters and punctuation),
   VAD and beam search. In *Auto* mode, Whisper often labels Urdu speech as **Hindi** (they sound nearly identical).
   When an Urdu output is requested, the app then transcribes as Urdu automatically.
2. **Transliterate, don't translate.** Each word is converted with this priority:
   your dictionary → two-word phrases (اسلام آباد) → **context rules** (کیا = *kya* or *kiya* depending on the
   neighbouring words, میں = *me* (I) or *mein* (in)) → lexicon of common words, names and places →
   morphology (plural/oblique endings, attached postpositions) → **English code-switch detection** (پراجکٹ, پروجیکٹ → *project*,
   matched by a phonetic consonant skeleton) → a vowel-aware rule-based fallback for unknown words.
   Future-tense particles merge into the verb (جاؤں گا → *jaunga*) and the merged word keeps the combined timing.
3. **Example:** `میں کل سے لاہور جاؤں گا۔` → `Me kal se Lahore jaunga.`
4. The Urdu original of every word is stored, so you can switch between Urdu script and Roman Urdu without re-transcribing,
   and fix recurring spellings once in the **Roman Urdu dictionary** (book icon).

Roman Urdu has no standard spelling (bohat/bahut, hai/he). The built-in choices follow common Pakistani usage and
everything is editable.

### Syncing your own transcript

When the speech model mishears words, the *text* is wrong but its *timing* is still good: it knows when each word was
said. "Use my own transcript" uses Whisper only as a timing reference:

1. The video is transcribed once (the raw word timings are cached per video/model/language, so syncing again takes seconds).
2. Your words and Whisper's words are turned into spelling-insensitive phonetic keys (*bohat* ≈ *bahut*, *nahin* ≈ *nahi*,
   `عبداللہ` ≈ *Abdullah*). Urdu/Hindi script on either side is romanised first.
3. **Anchors:** words that occur exactly once on both sides (names, rare nouns), kept in a consistent order (longest
   increasing subsequence), so repeated phrases can't pull the alignment to the wrong place.
4. Between anchors, a similarity-weighted alignment (dynamic programming) matches the rest. Skipping a user word is free (it
   may have been misheard); skipping speech between matched words costs a little, so a word is never matched to the same
   word said much earlier. Speech before/after the transcript is ignored, so a transcript may cover only part of the video.
5. Matched words take Whisper's timing; unmatched words are timed between their neighbours. Captions are then built like
   auto-generate, or one per line of your text. SRT/VTT input is accepted (its timings are ignored and re-synced).

The result tells you what share of your words was matched to the audio.

### Word-level timestamps

Faster-Whisper produces per-word timestamps (cross-attention + DTW). The app cleans them up (monotonic, non-zero
length), groups words into captions (sentences kept together, long ones split evenly, preferring commas and pauses) and
stores every word with its time in SQLite. When you edit text, an LCS diff keeps the real timing of unchanged words and
interpolates only new ones. If **WhisperX** is installed (`pip install whisperx`), word boundaries are refined with
wav2vec2 forced alignment automatically, for languages that have an alignment model (Urdu and English do).

### How captions are rendered (preview == export)

* All style sizes are defined for a frame whose short side is 1080 px and scale with the output size.
* **One layout algorithm, two implementations:** `caption_layout.py` and `captionLayout.ts` wrap lines and compute
  boxes identically, measuring text from the **same font files** (HarfBuzz in Python, the browser shaper in TS).
* **Export** converts captions to an ASS script whose PlayRes equals the output frame, then FFmpeg burns it with libass:
  rounded backgrounds are vector drawings, shadows are blurred layers, word highlighting uses timed `\t` colour transitions,
  animations use `\fad`, `\move`, `\t(\fscx…)`. The fonts are copied into a private `fontsdir`.
  libass font sizing is converted from CSS sizing using each font's metrics.
* **Preview** draws the same layout as DOM/SVG on top of the HTML5 video, recomputed per frame for animations and word states.
  Style changes never re-render the video.

---

## API (main endpoints)

```
POST   /api/projects                     GET /api/projects     GET|PATCH|DELETE /api/projects/{id}
GET    /api/projects/{id}/history        POST /api/projects/{id}/history/{snapshot}/restore
POST   /api/videos/upload?projectId=&filename=     (raw streaming body)
GET    /api/videos/{id}/metadata | /stream (range) | /waveform      DELETE /api/videos/{id}
GET    /api/transcription/options        POST /api/transcription/start        GET /api/transcription/{job}/status
POST   /api/transcription/align          {projectId, text, language, model, captionLength, lineMode: auto|lines}
GET    /api/subtitles/{project}          PUT  /api/subtitles/{project}         (whole document, used by auto-save)
POST   /api/subtitles/{project}/segments PUT|DELETE /api/subtitles/segment/{segment}
POST   /api/subtitles/{project}/convert  GET  /api/subtitles/{project}/download/{srt|vtt|ass}
POST   /api/export/start                 GET  /api/export/{job}/status         GET /api/export/{job}/download?file=mp4
POST   /api/jobs/{job}/cancel            GET  /api/presets | /api/fonts | /api/dictionary | /api/system/status
WS     /api/ws?projectId=…               live job progress, video-ready and captions-ready events
```

Interactive docs: http://127.0.0.1:8000/docs

---

## Tested

Tested on Windows 11, i5-10210U (4 cores), 8 GB RAM, no GPU, `small` model, int8:

| Test | Result |
|---|---|
| English speech (12 s) | Language detected `en` (99.6 %), transcript correct, transcription 11 s |
| Urdu speech → Roman Urdu (9:16 HEVC MKV) | `Assalam alaikum dosto, me kal se Lahore jaunga. Aaj hum ne naye project ke baare mein meeting ki.` Preview proxy generated automatically |
| Mixed Urdu-English | `Aaj ki meeting bohat achi thi. Hum ne apna project complete kar liya hai aur kal presentation hogi.` |
| Urdu script ↔ Roman Urdu conversion | round-trips without re-transcription, word timings preserved |
| Preview vs export | Screenshot of the browser preview and the FFmpeg frame at the same time match (wrapping, box, outline, shadow, position) |
| Export | H.264 720p/1080p/original, 9:16 and 16:9, burned captions; word highlight follows audio |
| Own transcript sync | Roman Urdu with different spellings, extra/missing words, misheard words, kept lines, Urdu script and SRT input all land on the right audio; 30-minute transcript (4,200 words) aligned in 0.3 s; partial transcripts (start/middle/end only) placed correctly |
| Editor UI (Edge, automated) | upload → process → generate → edit / split / merge / undo / redo / timeline drag / preset / word colour / save → export, no console errors |
| Cancellation & validation | running transcription cancels cleanly; unsupported language/resolution rejected with clear messages |
| 5-minute 1080p, 200 MB | see "Performance" below |

TTS-generated speech was used for the automated tests. Real recordings with background noise, accents or overlapping
speakers will be less accurate. Use a larger model for difficult audio.

### Performance

5-minute 1080p30 video (200 MB), same laptop, `small` model on CPU:

| Step | Time |
|---|---|
| Upload (local) | 3.6 s |
| Processing (metadata, audio, waveform, language ID) | 52 s |
| Transcription (55 captions, beam search 5) | 12 min 49 s (≈ 2.6× the video length) |
| Export 1080p H.264 "medium" with burned captions | 3 min 33 s |
| Peak backend RAM | 0.9 GB |

Transcription is the slow part on a 4-core laptop CPU. A smaller model (`base`) is faster but much worse for Urdu.
An NVIDIA GPU (`WHISPER_DEVICE=cuda`) makes it many times faster. Style changes never require re-transcription or re-rendering.

---

## Limitations (honest list)

* **AI transcription is never 100 % accurate.** Noise, music, accents, fast or overlapping speech reduce accuracy. Always review.
  For Urdu, `small` is usable but `medium` / `large-v3-turbo` are clearly better (slower on CPU).
* **Roman Urdu spelling** is rule- and lexicon-based. Common words, names and English loanwords are handled; rare words
  use a heuristic and may need a fix (add it to the dictionary once). The transliteration can only be as good as the
  Urdu text the speech model heard. For exact text, use **Use my own transcript**.
* **Speaker diarization** (who is speaking) is not included in the default install. It needs pyannote with a Hugging Face token.
  Segments have a `speaker` field ready for it.
* **English translation** uses Whisper's built-in speech translation (any language → English). Other target languages
  would need a separate machine-translation model.
* Languages written without spaces (Chinese, Japanese, Thai) are captioned per segment; word-level highlighting works best
  for space-separated languages.
* If a font lacks Urdu letters (e.g. Poppins), the UI warns you. Use Gulzar, Lateef, Arial, Segoe UI or Tahoma for Urdu script.
* Transcription runs one job at a time to protect memory on 8 GB machines. CPU transcription of long videos with large
  models can take longer than the video itself.

## Troubleshooting

* **"FFmpeg was not found" / missing libass:** install a full build (`winget install Gyan.FFmpeg`), reopen the terminal,
  or set `FFMPEG_BIN`/`FFPROBE_BIN` in `.env`.
* **Model download fails:** the first run needs internet access to huggingface.co; after that it works offline.
* **Out of memory:** choose a smaller model in the generate dialog, or close other applications.
* **Video doesn't play in the preview:** a preview proxy is created for non-browser formats. Wait for processing to finish.
* Logs are printed in the `start.bat` console window.

## Fonts

Bundled under the SIL Open Font License: Gulzar, Lateef, Poppins, Anton, Bebas Neue (`backend/fonts/bundled`).
Windows system fonts (Arial, Segoe UI, …) are used from `C:\Windows\Fonts`. Upload your own `.ttf/.otf` in the font picker.
