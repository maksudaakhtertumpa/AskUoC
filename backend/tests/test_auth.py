"""Unified sign-in with automatic roles: the server decides what each person is; nobody picks a role."""

from app.accounts import Account
from app.security import hash_password

PW = "a-long-enough-password"


async def make(client, username, role, password=PW):
    await client.app_state.accounts.create(Account(username=username, password_hash=hash_password(password), role=role))


def bearer(token):
    return {"authorization": f"Bearer {token}"}


async def login(client, username, password=PW):
    return await client.post("/auth/login", json={"username": username, "password": password})


async def test_first_admin_setup_flow(client):
    assert (await client.get("/auth/status")).json() == {"signup": True, "admin_console": True, "needs_setup": True}
    body = {"setup_key": "wrong", "username": "boss", "password": PW}
    assert (await client.post("/auth/setup", json=body)).status_code == 401
    r = await client.post("/auth/setup", json={**body, "setup_key": "s3cret"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
    assert (
        await client.post("/auth/setup", json={**body, "setup_key": "s3cret", "username": "other"})
    ).status_code == 409
    assert (await client.get("/auth/status")).json()["needs_setup"] is False


async def test_register_creates_a_plain_user_and_validates(client):
    r = await client.post("/auth/register", json={"username": "Ann", "password": PW, "display_name": "Ann L."})
    assert r.status_code == 200 and r.json()["user"]["role"] == "user" and r.json()["user"]["username"] == "ann"
    assert (await client.post("/auth/register", json={"username": "ann", "password": PW})).status_code == 409
    assert (await client.post("/auth/register", json={"username": "bob", "password": "short"})).status_code == 422
    assert (await client.post("/auth/register", json={"username": "no spaces", "password": PW})).status_code == 422


async def test_login_returns_role_automatically_no_role_selector(client):
    await make(client, "ann", "user")
    await make(client, "sam", "staff")
    await make(client, "boss", "admin")
    roles = {u: (await login(client, u)).json()["user"]["role"] for u in ("ann", "sam", "boss")}
    assert roles == {"ann": "user", "sam": "staff", "boss": "admin"}  # same form, server decides
    assert (await login(client, "ann", "wrong-password-here")).status_code == 401
    assert (await login(client, "ghost")).status_code == 401  # unknown user looks the same as a wrong password


async def test_admin_area_is_gated_by_role(client):
    for u, r in (("ann", "user"), ("sam", "staff"), ("boss", "admin")):
        await make(client, u, r)
    tok = {u: (await login(client, u)).json()["token"] for u in ("ann", "sam", "boss")}
    assert (await client.get("/admin/stats")).status_code == 401
    assert (await client.get("/admin/stats", headers=bearer(tok["ann"]))).status_code == 403  # users never get in
    assert (await client.get("/admin/stats", headers=bearer(tok["sam"]))).status_code == 200  # staff: stats
    assert (await client.get("/admin/stats", headers=bearer(tok["boss"]))).status_code == 200
    assert (await client.get("/metrics", headers=bearer(tok["sam"]))).status_code == 403  # admin only
    assert (await client.get("/metrics", headers=bearer(tok["boss"]))).status_code == 200
    assert (await client.get("/auth/me", headers=bearer(tok["sam"]))).json()["role"] == "staff"


async def test_break_glass_admin_token_still_works_for_automation(client):
    assert (await client.get("/admin/stats", headers={"x-admin-token": "s3cret"})).status_code == 200
    assert (await client.get("/metrics", headers=bearer("s3cret"))).status_code == 200


async def test_account_lockout_after_repeated_failures_even_with_right_password(client):
    await make(client, "ann", "user")
    codes = [(await login(client, "ann", "bad-password-attempt")).status_code for _ in range(8)]
    assert codes == [401] * 8
    assert (await login(client, "ann")).status_code == 429  # correct password, but locked
    assert (await login(client, "bob")).status_code == 401  # other accounts unaffected


async def test_password_change_revokes_old_sessions(client):
    await make(client, "ann", "user")
    old = (await login(client, "ann")).json()["token"]
    assert (
        await client.post(
            "/auth/password",
            headers=bearer(old),
            json={"current_password": "nope-nope-nope", "new_password": "another-long-pass"},
        )
    ).status_code == 401
    r = await client.post(
        "/auth/password", headers=bearer(old), json={"current_password": PW, "new_password": "another-long-pass"}
    )
    new = r.json()["token"]
    assert (await client.get("/auth/me", headers=bearer(old))).status_code == 401  # old session revoked
    assert (await client.get("/auth/me", headers=bearer(new))).status_code == 200
    assert (await login(client, "ann", "another-long-pass")).status_code == 200


async def test_disabled_account_is_locked_out_immediately(client):
    await make(client, "sam", "staff")
    tok = (await login(client, "sam")).json()["token"]
    await client.app_state.accounts.update("sam", disabled=True)
    assert (await client.get("/admin/stats", headers=bearer(tok))).status_code == 401
    assert (await login(client, "sam")).status_code == 401


async def test_delete_own_account_and_last_admin_protection(client):
    await make(client, "ann", "user")
    await make(client, "boss", "admin")
    ann = (await login(client, "ann")).json()["token"]
    assert (
        await client.request("DELETE", "/auth/me", headers=bearer(ann), json={"password": "wrong-password"})
    ).status_code == 401
    assert (await client.request("DELETE", "/auth/me", headers=bearer(ann), json={"password": PW})).status_code == 200
    assert (await login(client, "ann")).status_code == 401
    boss = (await login(client, "boss")).json()["token"]
    assert (await client.request("DELETE", "/auth/me", headers=bearer(boss), json={"password": PW})).status_code == 409


async def test_signup_can_be_disabled(settings, store, tmp_path):
    import httpx
    from app.config import Settings
    from app.main import create_app

    app = create_app(
        Settings(
            chunks_path=settings.chunks_path,
            index_path=settings.index_path,
            chat_log_path=tmp_path / "l.jsonl",
            accounts_path=tmp_path / "a.json",
            kv_path=tmp_path / "kv.json",
            cache_backend="memory",
            allow_signup=False,
        )
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.post("/auth/register", json={"username": "ann", "password": PW})).status_code == 403
