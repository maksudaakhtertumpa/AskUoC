"""Read-aloud via edge-tts (free, undocumented service; the frontend falls back to browser speech on failure)."""

from __future__ import annotations

import hashlib
import re

import edge_tts

MAX_CHARS = 3500
VOICE_EN = "en-US-AriaNeural"
VOICE_MS = "ms-MY-YasminNeural"

# common Malay function words, enough to tell BM from English
_MALAY = frozenset(
    "yang dan untuk dengan dalam adalah pada ini itu atau dari kepada juga akan boleh tidak ada kami anda "
    "program pelajar universiti yuran biasiswa permohonan".split()
)


def clean_for_speech(md: str) -> str:
    """Markdown answer -> text that sounds natural when spoken."""
    text = re.sub(r"```[\s\S]*?```", " ", md)
    text = re.sub(r"\[\d+\]", "", text)  # citation badges
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)  # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # links -> label
    text = re.sub(r"(?m)^\s*\|?[\s:|-]{3,}\|?\s*$", "", text)  # table separator rows
    text = text.replace("|", ", ")
    text = re.sub(r"(?m)^#{1,6}\s*", "", text)
    text = re.sub(r"[*_`>~]", "", text)
    text = re.sub(r"(?m)^\s*[-•]\s+", "", text)
    text = re.sub(r"https?://\S+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def pick_voice(text: str) -> str:
    words = re.findall(r"[a-z]+", text.lower())
    if words and sum(w in _MALAY for w in words) / len(words) > 0.12:
        return VOICE_MS
    return VOICE_EN


async def synthesize(markdown: str, cache=None, ttl: int = 7 * 24 * 3600, voice: str | None = None) -> bytes:
    """MP3 bytes for the given (markdown) text, cached by voice + text. Raises ValueError for empty input."""
    text = clean_for_speech(markdown)[:MAX_CHARS]
    if not text:
        raise ValueError("Nothing to read.")
    voice = voice or pick_voice(text)
    key = hashlib.sha256(f"{voice}|{text}".encode()).hexdigest()
    if cache is not None and (hit := await cache.get("tts", key)) is not None:
        return hit
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    if not audio:
        raise RuntimeError("TTS returned no audio.")
    if cache is not None:
        await cache.set("tts", key, bytes(audio), ttl)
    return bytes(audio)
