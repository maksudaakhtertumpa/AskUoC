"""Admin data pipeline: upload, extract, chunk, embed, search, roles and cache invalidation."""

import json
import re

from app.ingestion import service as ingest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .test_api import FEES_Q, ask

NOTE = b"# Zephyr Scholarship\n\nThe Zephyr Scholarship gives RM 7,777 to students who build open-source chatbots for the university."


async def upload(client, headers, name="zephyr.md", data=NOTE, **form):
    r = await client.post(
        "/admin/ingest", headers=headers, files={"file": (name, data, "application/octet-stream")}, data=form
    )
    return r


async def finish(client, r, headers):
    assert r.status_code == 200, r.text
    await client.app_state.jobs.wait_all()
    return (await client.get(f"/admin/jobs/{r.json()['id']}", headers=headers)).json()


def pdf_bytes(tmp_path, text="The library extends its opening hours during examination weeks for every student."):
    p = tmp_path / "x.pdf"
    c = canvas.Canvas(str(p), pagesize=A4)
    c.drawString(72, 760, text)
    c.save()
    return p.read_bytes()


async def test_uploaded_markdown_becomes_searchable(client, staff):
    job = await finish(client, await upload(client, staff, title="Zephyr Scholarship", doc_type="funding"), staff)
    assert job["status"] == "done" and job["result"]["chunks"] >= 1
    docs = (await client.get("/admin/documents", headers=staff)).json()
    assert any(d["title"] == "Zephyr Scholarship" and d["doc_type"] == "funding" for d in docs["documents"])
    _, d = await ask(client, "How much is the Zephyr Scholarship?")
    assert d["done"]["outcome"] == "answered"
    assert any("Zephyr" in s["title"] for s in d["sources"]["sources"])


async def test_new_data_invalidates_cached_answers(client, staff):
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "miss"
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "hit"
    await finish(client, await upload(client, staff), staff)
    assert (await ask(client, FEES_Q))[1]["done"]["cache"] == "miss"  # data version changed -> stale answers not served


async def test_pdf_upload_extracts_text(client, staff, tmp_path):
    job = await finish(client, await upload(client, staff, "hours.pdf", pdf_bytes(tmp_path)), staff)
    assert job["status"] == "done"
    doc = next(
        d for d in (await client.get("/admin/documents", headers=staff)).json()["documents"] if d["doc_type"] == "pdf"
    )
    assert doc["url"].startswith("upload://hours")


async def test_pdf_without_text_fails_with_a_helpful_message(client, staff, tmp_path):
    p = tmp_path / "blank.pdf"
    c = canvas.Canvas(str(p), pagesize=A4)
    c.showPage()
    c.save()
    job = await finish(client, await upload(client, staff, "blank.pdf", p.read_bytes()), staff)
    assert job["status"] == "failed" and "no readable text" in job["error"]


async def test_crawler_json_and_html_uploads(client, staff):
    html = "<html><head><title>Hostel | University of Cyberjaya</title></head><body><main><h1>Hostel rules</h1><p>Quiet hours begin at ten in the evening every night of the week.</p></main></body></html>"
    pages = json.dumps(
        [{"url": "https://cyberjaya.edu.my/campus-life/hostel", "doc_type": "page", "html": html}]
    ).encode()
    job = await finish(client, await upload(client, staff, "uoc_pages_001.json", pages), staff)
    assert job["status"] == "done"
    urls = [d["url"] for d in (await client.get("/admin/documents", headers=staff)).json()["documents"]]
    assert "https://cyberjaya.edu.my/campus-life/hostel" in urls
    job = await finish(client, await upload(client, staff, "page.html", html.encode()), staff)
    assert job["status"] == "done"
    assert (await finish(client, await upload(client, staff, "bad.json", b"{not json"), staff))["status"] == "failed"


async def test_paste_text_faq(client, staff):
    r = await client.post(
        "/admin/ingest/text",
        headers=staff,
        json={
            "title": "Parking FAQ",
            "markdown": "Visitors may park in Zone C for up to four hours each day without a permit.",
        },
    )
    assert (await finish(client, r, staff))["status"] == "done"


async def test_validation(client, staff, monkeypatch):
    assert (await upload(client, staff, "virus.exe", b"MZ")).status_code == 422
    assert (await upload(client, staff, "fake.pdf", b"not a pdf")).status_code == 422
    assert (await upload(client, staff, doc_type="weird")).status_code == 422
    assert (await upload(client, staff, url="https://evil.example/x")).status_code == 422
    monkeypatch.setattr(ingest, "MAX_UPLOAD_BYTES", 100)
    assert (await upload(client, staff, data=b"x" * 500)).status_code == 413
    r = await client.post("/admin/ingest/text", headers=staff, json={"title": "x", "markdown": "short"})
    assert r.status_code == 422


async def test_role_matrix_for_data_endpoints(client, staff, user, admin):
    assert (await client.get("/admin/documents")).status_code == 401
    assert (await client.get("/admin/documents", headers=user)).status_code == 403
    assert (await upload(client, user)).status_code == 403
    assert (await upload(client, staff)).status_code == 200  # staff may add data
    await client.app_state.jobs.wait_all()
    assert (await client.request("DELETE", "/admin/documents", headers=staff, json={"url": "x"})).status_code == 403
    assert (await client.post("/admin/reindex", headers=staff)).status_code == 403
    assert (await client.get("/admin/audit", headers=staff)).status_code == 403
    assert (await client.get("/admin/audit", headers=admin)).status_code == 200


async def test_delete_document_and_audit_trail(client, staff, admin):
    await finish(client, await upload(client, staff, title="Zephyr Scholarship"), staff)
    url = next(
        d["url"]
        for d in (await client.get("/admin/documents", headers=admin)).json()["documents"]
        if d["title"] == "Zephyr Scholarship"
    )
    assert (await client.request("DELETE", "/admin/documents", headers=admin, json={"url": "nope"})).status_code == 404
    assert (await client.request("DELETE", "/admin/documents", headers=admin, json={"url": url})).json()[
        "removed_chunks"
    ] >= 1
    urls = [d["url"] for d in (await client.get("/admin/documents", headers=admin)).json()["documents"]]
    assert url not in urls
    events = (await client.get("/admin/audit", headers=admin)).json()["events"]
    actions = [e["action"] for e in events]
    assert "data.upload" in actions and "document.delete" in actions
    assert re.search(r"sam", json.dumps(events))  # who did it is recorded


async def test_reindex_reembeds_everything_and_records_the_index(client, admin):
    r = await client.post("/admin/reindex", headers=admin)
    job = await finish(client, r, admin)
    assert job["status"] == "done" and job["result"]["chunks"] == 5
    view = (await client.get("/admin/settings", headers=admin)).json()
    assert view["index"]["stale"] is False and view["index"]["chunks"] == 5


async def test_unknown_job_is_404(client, staff):
    assert (await client.get("/admin/jobs/nope", headers=staff)).status_code == 404
    assert (await client.get("/admin/jobs", headers=staff)).json() == {"jobs": []}
