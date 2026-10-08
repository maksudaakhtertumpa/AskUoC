"""Admin console runtime settings: validated, encrypted at rest, hot-reloaded, never echoed."""

import json

import httpx
from app.config import Settings
from app.main import create_app
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from .test_api import FEES_Q, ask

KEY = "sk-secret-key-123456"


def by_key(view):
    return {f["key"]: f for f in view["fields"]}


async def test_only_admins_can_see_or_change_settings(client, admin, staff, user):
    assert (await client.get("/admin/settings")).status_code == 401
    assert (await client.get("/admin/settings", headers=user)).status_code == 403
    assert (await client.get("/admin/settings", headers=staff)).status_code == 403
    assert (
        await client.put("/admin/settings", headers=staff, json={"values": {"min_coverage": 0.3}})
    ).status_code == 403
    assert (await client.get("/admin/settings", headers=admin)).status_code == 200


async def test_save_applies_live_and_keeps_secrets_encrypted_and_hidden(client, admin, tmp_path):
    st = client.app_state
    r = await client.put(
        "/admin/settings",
        headers=admin,
        json={
            "values": {
                "llm_provider": "openai_compatible",
                "llm_base_url": "http://localhost:11434/v1",
                "openai_llm_model": "llama3.1",
                "llm_api_key": KEY,
                "min_coverage": 0.3,
                "system_prompt_extra": "Always greet in Bahasa Melayu first.",
            }
        },
    )
    assert r.status_code == 200
    f = by_key(r.json())
    assert (
        f["llm_api_key"]["is_set"] is True
        and f["llm_api_key"]["masked"] == "••••3456"
        and f["llm_api_key"]["value"] == ""
    )
    assert KEY not in r.text  # never returned to the browser
    assert f["openai_llm_model"]["value"] == "llama3.1" and f["openai_llm_model"]["source"] == "admin"
    assert st.settings.llm_provider == "openai_compatible" and st.settings.min_coverage == 0.3
    assert type(st.llm).__name__ == "ChatOpenAI" and st.llm.model_name == "llama3.1"
    stored = (tmp_path / "kv.json").read_text()
    assert KEY not in stored and "enc:v1:" in stored
    await client.put("/admin/settings", headers=admin, json={"values": {"llm_api_key": ""}})
    assert st.settings.llm_api_key == KEY
    await client.put(
        "/admin/settings", headers=admin, json={"values": {"llm_api_key": "__clear__", "min_coverage": "__clear__"}}
    )
    assert st.settings.llm_api_key is None and st.settings.min_coverage == 0.5


async def test_invalid_values_are_rejected_with_clear_messages(client, admin):
    for values, hint in [
        ({"nope": 1}, "can't be changed"),
        ({"llm_provider": "skynet"}, "choose one of"),
        ({"llm_base_url": "ftp://x"}, "http"),
        ({"min_coverage": 7}, "between"),
        ({"retrieve_k": 1}, "between"),
        ({"system_prompt_extra": "x" * 1600}, "1500"),
    ]:
        r = await client.put("/admin/settings", headers=admin, json={"values": values})
        assert r.status_code == 422 and hint in r.json()["detail"], (values, r.text)
    assert client.app_state.overrides == {}  # nothing half-saved


async def test_settings_survive_a_restart(client, admin, settings, tmp_path):
    await client.put("/admin/settings", headers=admin, json={"values": {"context_k": 3, "llm_api_key": KEY}})
    s2 = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "logs.jsonl",
        accounts_path=tmp_path / "accounts.json",
        kv_path=tmp_path / "kv.json",
        cache_backend="memory",
        admin_token="s3cret",
    )
    app2 = create_app(s2)
    async with app2.router.lifespan_context(app2):
        assert app2.state.ctx.settings.context_k == 3 and app2.state.ctx.settings.llm_api_key == KEY


async def test_secrets_are_unreadable_if_the_server_secret_changes(client, admin, settings, tmp_path):
    await client.put("/admin/settings", headers=admin, json={"values": {"llm_api_key": KEY}})
    s2 = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "logs.jsonl",
        accounts_path=tmp_path / "accounts.json",
        kv_path=tmp_path / "kv.json",
        cache_backend="memory",
        admin_token="different",
    )
    app2 = create_app(s2)
    async with app2.router.lifespan_context(app2):
        assert app2.state.ctx.settings.llm_api_key is None  # not decryptable -> treated as unset, no crash


async def test_prompt_change_invalidates_the_answer_cache(client, admin):
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "miss"
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "hit"
    await client.put("/admin/settings", headers=admin, json={"values": {"system_prompt_extra": "Be extra brief."}})
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "miss"  # new fingerprint -> old answers not reused


async def test_changing_the_embedding_model_flags_the_index_as_stale(client, admin):
    v = (await client.get("/admin/settings", headers=admin)).json()
    assert v["index"]["stale"] is False
    v = (
        await client.put(
            "/admin/settings",
            headers=admin,
            json={
                "values": {
                    "embed_provider": "openai_compatible",
                    "openai_embed_model": "nomic-embed-text",
                    "embed_base_url": "http://localhost:11434/v1",
                }
            },
        )
    ).json()
    assert v["index"]["stale"] is True and v["index"]["built_with"].startswith("hash:")


async def test_connection_test_reports_success_and_redacts_keys_in_errors(client, admin, monkeypatch):
    import app.rag.llm as llm_mod

    monkeypatch.setattr(llm_mod, "get_llm", lambda s: GenericFakeChatModel(messages=iter([AIMessage("OK")])))
    r = (await client.post("/admin/settings/test", headers=admin, json={"target": "llm", "values": {}})).json()
    assert r["ok"] is True and r["detail"] == "OK"

    def boom(s):
        raise RuntimeError(f"401 Unauthorized for key {KEY}")

    monkeypatch.setattr(llm_mod, "get_llm", boom)
    r = (
        await client.post("/admin/settings/test", headers=admin, json={"target": "llm", "values": {"llm_api_key": KEY}})
    ).json()
    assert r["ok"] is False and KEY not in json.dumps(r) and "••••" in r["detail"]
    assert client.app_state.settings.llm_api_key is None  # a test never saves the draft


async def test_embedding_test_checks_dimensions(client, admin, monkeypatch):
    import app.rag.embed as emb_mod

    class Small:
        async def embed_query(self, t):
            return [0.1] * 384

    monkeypatch.setattr(emb_mod, "get_embedder", lambda s, cache=None: Small())
    r = (await client.post("/admin/settings/test", headers=admin, json={"target": "embedding", "values": {}})).json()
    assert r["ok"] is False and r["dim"] == 384 and "needs 768" in r["detail"]


async def test_unauthorised_test_is_refused(client, staff):
    assert (
        await client.post("/admin/settings/test", headers=staff, json={"target": "llm", "values": {}})
    ).status_code == 403
    assert isinstance(httpx.Timeout(1), httpx.Timeout)
