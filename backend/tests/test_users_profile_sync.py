"""Admin user management, profile & avatar, data export, and cross-device chat sync."""

import base64
import json

from app import storage as storage_mod

PW = "a-long-enough-password"
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 64).decode()


def bearer(t):
    return {"authorization": f"Bearer {t}"}


async def login(client, u, pw=PW):
    r = await client.post("/auth/login", json={"username": u, "password": pw})
    return r.json()["token"] if r.status_code == 200 else None


async def test_admin_can_create_staff_who_then_get_the_staff_panel_automatically(client, admin):
    r = await client.post(
        "/admin/users",
        headers=admin,
        json={"username": "Sam", "password": PW, "role": "staff", "display_name": "Sam Lee"},
    )
    assert r.status_code == 200 and r.json()["role"] == "staff" and "password" not in r.text
    tok = await login(client, "sam")  # same login form; the server finds the role
    assert (await client.get("/auth/me", headers=bearer(tok))).json()["role"] == "staff"
    assert (await client.get("/admin/stats", headers=bearer(tok))).status_code == 200
    assert (await client.get("/admin/users", headers=bearer(tok))).status_code == 403  # staff never see user management
    assert (
        await client.post("/admin/users", headers=admin, json={"username": "sam", "password": PW})
    ).status_code == 409
    assert (
        await client.post("/admin/users", headers=admin, json={"username": "x1", "password": PW, "role": "emperor"})
    ).status_code == 422
    assert (
        await client.post("/admin/users", headers=admin, json={"username": "bob", "password": "short"})
    ).status_code == 422
    listing = (await client.get("/admin/users", headers=admin)).json()
    assert {u["username"] for u in listing["users"]} == {"boss", "sam"} and "password_hash" not in json.dumps(listing)


async def test_role_password_and_disable_changes_sign_the_user_out_immediately(client, admin):
    await client.post("/admin/users", headers=admin, json={"username": "sam", "password": PW, "role": "staff"})
    t1 = await login(client, "sam")
    await client.patch("/admin/users/sam", headers=admin, json={"role": "user"})  # demoted
    assert (await client.get("/admin/stats", headers=bearer(t1))).status_code == 401
    t2 = await login(client, "sam")
    assert (await client.get("/admin/stats", headers=bearer(t2))).status_code == 403  # and the new role applies
    await client.patch("/admin/users/sam", headers=admin, json={"new_password": "brand-new-password-1"})
    assert (await client.get("/auth/me", headers=bearer(t2))).status_code == 401
    assert await login(client, "sam") is None and await login(client, "sam", "brand-new-password-1")
    t3 = await login(client, "sam", "brand-new-password-1")
    await client.patch("/admin/users/sam", headers=admin, json={"disabled": True})
    assert (await client.get("/auth/me", headers=bearer(t3))).status_code == 401
    assert await login(client, "sam", "brand-new-password-1") is None


async def test_the_last_admin_cannot_be_removed_disabled_or_demoted(client, admin):
    for action in (
        lambda: client.patch("/admin/users/boss", headers=admin, json={"role": "staff"}),
        lambda: client.patch("/admin/users/boss", headers=admin, json={"disabled": True}),
        lambda: client.delete("/admin/users/boss", headers=admin),
    ):
        assert (await action()).status_code == 409
    await client.post("/admin/users", headers=admin, json={"username": "coadmin", "password": PW, "role": "admin"})
    assert (
        await client.patch("/admin/users/coadmin", headers=admin, json={"role": "staff"})
    ).status_code == 200  # fine with 2 admins
    assert (
        await client.delete("/admin/users/boss", headers=admin)
    ).status_code == 409  # still: can't delete yourself here
    assert (await client.delete("/admin/users/nope", headers=admin)).status_code == 404


async def test_user_management_is_audited_without_secrets(client, admin):
    await client.post("/admin/users", headers=admin, json={"username": "sam", "password": PW, "role": "staff"})
    await client.patch(
        "/admin/users/sam", headers=admin, json={"new_password": "brand-new-password-1", "role": "admin"}
    )
    events = (await client.get("/admin/audit", headers=admin)).json()["events"]
    text = json.dumps(events)
    assert "user.create" in text and "user.update" in text and "brand-new-password-1" not in text and PW not in text
    upd = next(e for e in events if e["action"] == "user.update")
    assert "password" in upd["detail"]["changed"] and "role" in upd["detail"]["changed"]


async def test_profile_name_and_avatar_with_strict_validation(client, user):
    p = (await client.patch("/auth/profile", headers=user, json={"display_name": "  Ann Lee  ", "avatar": PNG})).json()
    assert p["display_name"] == "Ann Lee" and p["avatar"] == PNG and p["has_avatar"] is True
    assert (await client.get("/auth/profile", headers=user)).json()["avatar"] == PNG
    bad = {
        "data:image/svg+xml;base64,PHN2Zy8+": "PNG, JPEG or WebP",
        "data:image/png;base64,!!!": "PNG, JPEG or WebP",
        "data:image/png;base64," + base64.b64encode(b"not a png at all").decode(): "valid image",
        "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 120_000).decode(): "too large",
        "javascript:alert(1)": "PNG, JPEG or WebP",
        "https://evil.example/x.png": "PNG, JPEG or WebP",
    }
    for avatar, hint in bad.items():
        r = await client.patch("/auth/profile", headers=user, json={"avatar": avatar})
        assert r.status_code == 422 and hint in r.json()["detail"], avatar[:40]
    assert (await client.patch("/auth/profile", headers=user, json={"avatar": ""})).json()[
        "has_avatar"
    ] is False  # remove
    assert (await client.patch("/auth/profile", headers=user, json={"display_name": "x" * 100})).status_code == 422
    assert (await client.get("/auth/profile")).status_code == 401


async def test_login_response_stays_small_avatar_is_fetched_separately(client, user):
    await client.patch("/auth/profile", headers=user, json={"avatar": PNG})
    r = await client.post("/auth/login", json={"username": "ann", "password": PW})
    assert "avatar" not in r.json()["user"] and r.json()["user"]["has_avatar"] is True


async def test_data_export_contains_my_data_and_no_secrets(client, user):
    await client.put(
        "/me/conversations",
        headers=user,
        json={"conversations": [{"id": "c1", "updated_at": 5, "data": {"title": "Fees", "messages": []}}]},
    )
    r = await client.get("/auth/export", headers=user)
    assert (
        r.status_code == 200
        and "attachment" in r.headers["content-disposition"]
        and r.headers["cache-control"] == "no-store"
    )
    doc = r.json()
    assert doc["account"]["username"] == "ann" and doc["conversations"][0]["data"]["title"] == "Fees"
    assert "password" not in r.text and "scrypt" not in r.text and "pwv" not in r.text


async def test_sync_roundtrip_last_write_wins_and_validation(client, user):
    put = lambda items: client.put("/me/conversations", headers=user, json={"conversations": items})  # noqa: E731
    item = lambda i, ts, title: {"id": i, "updated_at": ts, "data": {"title": title}}  # noqa: E731
    assert (await put([item("a", 100, "v1"), item("b", 50, "b1")])).json() == {"stored": 2}
    await put([item("a", 90, "STALE")])  # an older device must not overwrite newer data
    await put([item("b", 60, "b2")])
    got = {
        c["id"]: c["data"]["title"]
        for c in (await client.get("/me/conversations", headers=user)).json()["conversations"]
    }
    assert got == {"a": "v1", "b": "b2"}
    assert (await put([{"id": "../etc", "updated_at": 1, "data": {}}])).status_code == 422
    assert (await put([item(f"c{i}", i, "x") for i in range(101)])).status_code == 422
    assert (await put([{"id": "big", "updated_at": 1, "data": {"t": "x" * 210_000}}])).status_code == 413
    assert (await client.delete("/me/conversations/a", headers=user)).status_code == 200
    assert (await client.delete("/me/conversations/a", headers=user)).status_code == 404
    assert (await client.delete("/me/conversations", headers=user)).status_code == 200
    assert (await client.get("/me/conversations", headers=user)).json()["conversations"] == []


async def test_synced_chats_are_private_to_their_owner_even_from_admins(client, user, admin):
    await client.put(
        "/me/conversations",
        headers=user,
        json={"conversations": [{"id": "secret", "updated_at": 1, "data": {"title": "private"}}]},
    )
    assert (await client.get("/me/conversations", headers=admin)).json()[
        "conversations"
    ] == []  # admin sees only their own
    assert (await client.get("/me/conversations")).status_code == 401
    audit = json.dumps((await client.get("/admin/audit", headers=admin)).json())
    stats = json.dumps((await client.get("/admin/stats", headers=admin)).json())
    assert "private" not in audit and "private" not in stats and "secret" not in stats


async def test_only_the_newest_200_conversations_are_kept(client, user, monkeypatch):
    monkeypatch.setattr(storage_mod, "MAX_SYNCED", 5)
    items = [{"id": f"c{i}", "updated_at": i, "data": {}} for i in range(9)]
    assert (await client.put("/me/conversations", headers=user, json={"conversations": items})).json() == {"stored": 5}
    ids = {c["id"] for c in (await client.get("/me/conversations", headers=user)).json()["conversations"]}
    assert ids == {"c4", "c5", "c6", "c7", "c8"}


async def test_deleting_an_account_or_a_user_removes_their_synced_chats(client, user, admin):
    await client.put(
        "/me/conversations", headers=user, json={"conversations": [{"id": "x", "updated_at": 1, "data": {}}]}
    )
    assert await client.app_state.storage.list_user_conversations("ann")
    await client.request("DELETE", "/auth/me", headers=user, json={"password": PW})
    assert await client.app_state.storage.list_user_conversations("ann") == []
    await client.post("/admin/users", headers=admin, json={"username": "bob", "password": PW, "role": "user"})
    tok = await login(client, "bob")
    await client.put(
        "/me/conversations", headers=bearer(tok), json={"conversations": [{"id": "y", "updated_at": 1, "data": {}}]}
    )
    await client.delete("/admin/users/bob", headers=admin)
    assert await client.app_state.storage.list_user_conversations("bob") == []


async def test_oversized_sync_batches_are_rejected_by_the_body_limit(client, user):
    big = {
        "conversations": [{"id": f"c{i}", "updated_at": 1, "data": {"t": "x" * 190_000}} for i in range(40)]
    }  # ~7.6 MB
    r = await client.put(
        "/me/conversations",
        headers=user,
        content=json.dumps(big),
    )
    assert r.status_code in (413, 401)
