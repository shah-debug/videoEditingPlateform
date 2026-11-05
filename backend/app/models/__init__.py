"""SQLite schema.

projects        one editing project (name, editor settings, global caption style)
videos          the uploaded original video + derived assets (audio, waveform, proxy)
segments        caption segments (text shown, original-script text, timing, optional style override)
words           word-level timestamps belonging to a segment (+ per-word colour)
jobs            background jobs (processing, transcription, export) with progress
presets         built-in and user caption style presets
history         server-side snapshots of the subtitle document (restore previous states)
dictionary      user corrections for Urdu -> Roman Urdu transliteration
fonts           user-uploaded fonts
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("prj"))
    name: Mapped[str] = mapped_column(String, default="Untitled project")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # editor settings: aspectRatio, fitMode, padColor, sourceLanguage, outputScript, ...
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    # global caption style (see app/schemas/style.py for the full shape)
    style: Mapped[dict] = mapped_column(JSON, default=dict)
    # transcription metadata: detected language, probability, model, ...
    transcription: Mapped[dict] = mapped_column(JSON, default=dict)

    video: Mapped["Video | None"] = relationship(back_populates="project", uselist=False, cascade="all, delete-orphan")
    segments: Mapped[list["Segment"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Segment.start"
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("vid"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    original_filename: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    audio_path: Mapped[str | None] = mapped_column(String, nullable=True)
    waveform_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # legacy columns (timeline thumbnails were removed); kept so existing databases keep working
    thumbs_path: Mapped[str | None] = mapped_column(String, nullable=True)
    thumbs_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    proxy_path: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="uploaded")  # uploaded|processing|ready|error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_language: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_language_prob: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="video")


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("cap"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    start: Mapped[float] = mapped_column(Float)
    end: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text, default="")
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # original-script transcription
    speaker: Mapped[str | None] = mapped_column(String, nullable=True)
    style: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # per-caption override (partial)

    project: Mapped[Project] = relationship(back_populates="segments")
    words: Mapped[list["Word"]] = relationship(
        back_populates="segment", cascade="all, delete-orphan", order_by="Word.idx"
    )


class Word(Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    segment_id: Mapped[str] = mapped_column(ForeignKey("segments.id", ondelete="CASCADE"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    start: Mapped[float] = mapped_column(Float)
    end: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(String)
    source_text: Mapped[str | None] = mapped_column(String, nullable=True)
    probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    color: Mapped[str | None] = mapped_column(String, nullable=True)

    segment: Mapped[Segment] = relationship(back_populates="words")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("job"))
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String)  # process|transcribe|export
    status: Mapped[str] = mapped_column(String, default="queued")  # queued|running|done|error|cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    stage: Mapped[str] = mapped_column(String, default="")
    message: Mapped[str] = mapped_column(Text, default="")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Preset(Base):
    __tablename__ = "presets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("pst"))
    name: Mapped[str] = mapped_column(String)
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    style: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HistorySnapshot(Base):
    __tablename__ = "history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String, default="")
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DictionaryEntry(Base):
    __tablename__ = "dictionary"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String, unique=True, index=True)  # Urdu-script word
    target: Mapped[str] = mapped_column(String)  # Roman Urdu spelling


class UserFont(Base):
    __tablename__ = "fonts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("fnt"))
    family: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    bold: Mapped[bool] = mapped_column(Boolean, default=False)
    italic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
