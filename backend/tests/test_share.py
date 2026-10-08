import pytest
from app.share import ShareRequest
from app.storage import JsonlStorage
from pydantic import ValidationError

SNAP = {
    "title": "Fees",
    "messages": [
        {"role": "user", "content": "fees?", "sources": []},
        {
            "role": "assistant",
            "content": "RM 5,000 [1]",
            "sources": [{"n": 1, "title": "Fees", "url": "https://cyberjaya.edu.my/fees", "doc_type": "page"}],
        },
    ],
}


async def test_share_roundtrip_and_delete(tmp_path):
    st = JsonlStorage(tmp_path / "logs.jsonl")
    sid = await st.create_share(SNAP, "secret-token")
    got = await st.get_share(sid)
    assert got["title"] == "Fees" and got["messages"][1]["content"].startswith("RM")
    assert await st.delete_share(sid, "wrong") is False  # wrong token cannot delete
    assert await st.get_share(sid) is not None
    assert await st.delete_share(sid, "secret-token") is True
    assert await st.get_share(sid) is None


async def test_delete_token_is_stored_hashed(tmp_path):
    st = JsonlStorage(tmp_path / "logs.jsonl")
    await st.create_share(SNAP, "plain-token")
    assert "plain-token" not in (tmp_path / "shared_chats.json").read_text()


async def test_expired_share_is_gone(tmp_path):
    import json

    st = JsonlStorage(tmp_path / "logs.jsonl")
    sid = await st.create_share(SNAP, "t")
    p = tmp_path / "shared_chats.json"
    data = json.loads(p.read_text())
    data[sid]["expires"] = "2001-01-01T00:00:00+00:00"
    p.write_text(json.dumps(data))
    assert await st.get_share(sid) is None


def test_snapshot_validation():
    ShareRequest(**SNAP)
    bad = {
        **SNAP,
        "messages": [
            {
                "role": "assistant",
                "content": "x",
                "sources": [{"n": 1, "title": "x", "url": "javascript:alert(1)", "doc_type": "page"}],
            }
        ],
    }
    with pytest.raises(ValidationError):
        ShareRequest(**bad)  # only cyberjaya.edu.my links allowed
    with pytest.raises(ValidationError):
        ShareRequest(title="x", messages=[{"role": "user", "content": "a" * 8000}] * 30)  # too large
