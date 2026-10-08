import pytest
from app import tts
from app.cache import MemoryCache
from app.tts import clean_for_speech, pick_voice


def test_markdown_is_stripped_for_speech():
    md = "## Fees\n\nSee **Diploma in IT** [1] at [the page](https://x.test/p).\n\n| Programme | Fee |\n|---|---|\n| Nursing | RM 5,000 |\n\n- first\n- second"
    out = clean_for_speech(md)
    assert "**" not in out and "[1]" not in out and "https" not in out and "---" not in out and "#" not in out
    assert "Diploma in IT" in out and "the page" in out and "Nursing" in out and "first" in out


def test_voice_picks_malay_for_malay_text():
    assert pick_voice("Program ini adalah untuk pelajar yang ingin belajar dalam bidang kejururawatan") == tts.VOICE_MS
    assert pick_voice("The programme is open to international students") == tts.VOICE_EN


async def test_synthesize_uses_cache_and_rejects_empty(monkeypatch):
    calls = []

    class FakeComm:
        def __init__(self, text, voice):
            calls.append((text, voice))

        async def stream(self):
            yield {"type": "WordBoundary"}
            yield {"type": "audio", "data": b"ID3-fake-mp3"}

    monkeypatch.setattr(tts.edge_tts, "Communicate", FakeComm)
    cache = MemoryCache()
    assert await tts.synthesize("Hello **world** [1]", cache) == b"ID3-fake-mp3"
    assert await tts.synthesize("Hello **world** [1]", cache) == b"ID3-fake-mp3"
    assert len(calls) == 1 and calls[0][0] == "Hello world"  # second call served from cache
    with pytest.raises(ValueError):
        await tts.synthesize("[1] ** ", cache)
