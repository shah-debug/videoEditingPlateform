"""Speech recognition with Faster-Whisper (CTranslate2).

- Silero VAD (bundled with faster-whisper) skips silence/music and reduces hallucinations.
- word_timestamps=True gives per-word timing from Whisper's cross-attention (DTW); optionally refined with
  WhisperX forced alignment (see subtitle_alignment.py) when it is installed.
- Models are downloaded once into data/models and cached in memory.
"""
from __future__ import annotations

import gc
import logging
import threading
from pathlib import Path
from typing import Callable

from ..config import (MODELS_DIR, WHISPER_COMPUTE_TYPE, WHISPER_CPU_THREADS, WHISPER_DEFAULT_MODEL,
                      WHISPER_DEVICE)
from ..utils.proc import Cancelled

log = logging.getLogger(__name__)

AVAILABLE_MODELS = [
    {"id": "tiny", "label": "Tiny (fastest, lowest accuracy)", "sizeMB": 75},
    {"id": "base", "label": "Base (fast)", "sizeMB": 145},
    {"id": "small", "label": "Small (balanced, recommended for CPU)", "sizeMB": 484},
    {"id": "medium", "label": "Medium (better Urdu, slower)", "sizeMB": 1530},
    {"id": "large-v3-turbo", "label": "Large-v3 Turbo (best speed/accuracy for Urdu)", "sizeMB": 1620},
    {"id": "large-v3", "label": "Large-v3 (most accurate, slowest)", "sizeMB": 3090},
]

LANGUAGES = {
    "en": "English", "ur": "Urdu", "ar": "Arabic", "hi": "Hindi", "zh": "Chinese", "es": "Spanish",
    "fr": "French", "de": "German", "pa": "Punjabi", "ps": "Pashto", "fa": "Persian", "bn": "Bengali",
    "tr": "Turkish", "ru": "Russian", "pt": "Portuguese", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "id": "Indonesian", "ms": "Malay", "sd": "Sindhi", "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian",
    "vi": "Vietnamese", "th": "Thai", "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "mr": "Marathi",
    "gu": "Gujarati",
}

# A short prompt in the target script nudges Whisper to keep that script and to emit punctuation.
INITIAL_PROMPTS = {
    "ur": "السلام علیکم۔ آج ہم اس موضوع پر بات کریں گے، اور آپ کو سب کچھ بتائیں گے۔",
    "en": "Hello, and welcome. Today we're going to talk about this.",
    "hi": "नमस्ते, आज हम इस विषय पर बात करेंगे।",
    "ar": "مرحباً، اليوم سنتحدث عن هذا الموضوع.",
}

_models: dict[tuple, object] = {}
_model_lock = threading.Lock()
# Only one transcription at a time: Whisper models are memory heavy (8 GB machines).
transcribe_lock = threading.Semaphore(1)
# Set when the GPU turned out to be unusable (e.g. NVIDIA card present but CUDA/cuBLAS/cuDNN DLLs missing).
_cuda_broken = False

_CUDA_ERROR_HINTS = ("cublas", "cudnn", "cuda", "cudart", "nvrtc", "gpu")


def _is_cuda_error(e: BaseException) -> bool:
    msg = str(e).lower()
    return any(h in msg for h in _CUDA_ERROR_HINTS)


def _fall_back_to_cpu(e: BaseException) -> None:
    global _cuda_broken
    log.warning("GPU (CUDA) could not be used (%s). Falling back to CPU for this session.", e)
    _cuda_broken = True
    with _model_lock:
        _models.clear()
        gc.collect()


def _with_cpu_fallback(fn):
    """Run fn(); if it fails because the CUDA runtime is missing/broken, retry once on the CPU."""
    try:
        return fn()
    except Exception as e:
        if _cuda_broken or _device_and_compute()[0] != "cuda" or not _is_cuda_error(e):
            raise
        _fall_back_to_cpu(e)
        return fn()


def _device_and_compute() -> tuple[str, str]:
    device = WHISPER_DEVICE
    if _cuda_broken:
        device = "cpu"
    elif device == "auto":
        try:
            import ctranslate2

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    compute = WHISPER_COMPUTE_TYPE
    if compute == "auto" or (device == "cpu" and compute in ("float16", "int8_float16")):
        compute = "float16" if device == "cuda" else "int8"
    return device, compute


def is_model_downloaded(name: str) -> bool:
    slug = name if "/" in name else f"Systran/faster-whisper-{name}"
    if name == "large-v3-turbo":
        slug = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
    folder = MODELS_DIR / ("models--" + slug.replace("/", "--"))
    return folder.exists() and any(folder.rglob("model.bin"))


def get_model(name: str | None = None):
    from faster_whisper import WhisperModel

    name = name or WHISPER_DEFAULT_MODEL
    device, compute = _device_and_compute()
    key = (name, device, compute)
    with _model_lock:
        if key not in _models:
            # keep at most one model in memory
            _models.clear()
            gc.collect()
            _models[key] = WhisperModel(
                name, device=device, compute_type=compute, download_root=str(MODELS_DIR),
                cpu_threads=WHISPER_CPU_THREADS,
            )
        return _models[key]


def load_wav(audio_path: Path):
    """Load our 16 kHz mono PCM WAV (made by FFmpeg) as float32. Avoids faster-whisper's PyAV decoder, whose
    API differs between PyAV versions."""
    import wave

    import numpy as np

    with wave.open(str(audio_path), "rb") as wf:
        if wf.getframerate() != 16000 or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError("Audio must be 16 kHz mono 16-bit WAV (re-upload the video to regenerate it).")
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def detect_language(audio_path: Path, model_name: str | None = None) -> dict:
    """Language ID on up to ~30 s of detected speech."""
    audio = load_wav(audio_path)
    lang, prob, all_probs = _with_cpu_fallback(
        lambda: get_model(model_name).detect_language(audio, vad_filter=True, language_detection_segments=2))
    top = sorted(all_probs, key=lambda x: -x[1])[:5] if all_probs else []
    return {"language": lang, "probability": float(prob), "top": [{"language": l, "probability": float(p)}
                                                                   for l, p in top]}


def transcribe(
    audio_path: Path,
    language: str | None,
    task: str = "transcribe",
    model_name: str | None = None,
    on_progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    beam_size: int = 5,
) -> dict:
    audio = load_wav(audio_path)
    return _with_cpu_fallback(lambda: _transcribe(audio, language, task, model_name, on_progress, cancel, beam_size))


def _transcribe(audio, language, task, model_name, on_progress, cancel, beam_size) -> dict:
    model = get_model(model_name)
    duration = len(audio) / 16000.0
    prompt_lang = "en" if task == "translate" else language
    segments, info = model.transcribe(
        audio,
        language=language,
        task=task,
        beam_size=beam_size,
        best_of=5,
        temperature=[0.0, 0.2, 0.4, 0.6],
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPTS.get(prompt_lang or ""),
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
        hallucination_silence_threshold=2.0,
    )
    out_segments: list[dict] = []
    words: list[dict] = []
    for seg in segments:
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        seg_words = []
        for w in seg.words or []:
            text = (w.word or "").strip()
            if not text:
                continue
            item = {"text": text, "start": float(w.start), "end": float(w.end),
                    "probability": float(w.probability or 0)}
            seg_words.append(item)
            words.append(item)
        out_segments.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip(),
                             "words": seg_words, "avgLogprob": float(seg.avg_logprob),
                             "noSpeechProb": float(seg.no_speech_prob)})
        if on_progress and duration > 0:
            on_progress(min(0.999, seg.end / duration), seg.text.strip()[:80])
    return {
        "language": info.language,
        "languageProbability": float(info.language_probability),
        "duration": duration,
        "segments": out_segments,
        "words": words,
        "task": task,
    }
