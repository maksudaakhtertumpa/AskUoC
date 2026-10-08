from app.ingestion.pdfs import pdf_to_markdown
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def make_pdf(path, draw):
    c = canvas.Canvas(str(path), pagesize=A4)
    draw(c)
    c.save()


def test_pdf_text_and_reading_order(tmp_path):
    path = tmp_path / "Fee-Structure.pdf"

    def draw(c):
        c.drawString(72, 760, "Fee Structure 2026 for Malaysian students. Tuition is payable per semester.")
        c.drawString(72, 700, "Contact the finance office for instalment plans and payment deadlines.")

    make_pdf(path, draw)
    md = pdf_to_markdown(path)
    assert md.index("Fee Structure 2026") < md.index("instalment plans")
    assert pdf_to_markdown(path.read_bytes()) == md  # bytes input (uploads) gives the same result


def test_ruled_tables_become_markdown_tables(tmp_path):
    path = tmp_path / "table.pdf"

    def draw(c):
        c.drawString(72, 780, "Programme fees")
        rows = [("Programme", "Total (RM)"), ("Nursing", "40,150"), ("Pharmacy", "39,900")]
        y = 740
        for r in rows:
            c.rect(72, y - 6, 200, 24)
            c.line(172, y - 6, 172, y + 18)
            c.drawString(80, y, r[0])
            c.drawString(180, y, r[1])
            y -= 24

    make_pdf(path, draw)
    md = pdf_to_markdown(path)
    assert "| Programme | Total (RM) |" in md and "| Nursing | 40,150 |" in md and "| Pharmacy | 39,900 |" in md


def test_download_saves_real_pdfs_skips_existing_and_stops_when_challenged(tmp_path, monkeypatch):
    import httpx

    from ingest import pdfs

    urls = tmp_path / "urls.txt"
    urls.write_text("\n".join(f"https://site.test/uploads/{n}.pdf" for n in ("a", "b", "c", "d")))
    monkeypatch.setattr(pdfs, "PDF_URLS", urls)
    monkeypatch.setattr(pdfs, "EXTRA_URLS", tmp_path / "none.txt")
    monkeypatch.setattr(pdfs, "PDF_DIR", tmp_path / "pdfs")
    (tmp_path / "pdfs").mkdir()
    (tmp_path / "pdfs" / "a.pdf").write_bytes(b"%PDF-already here")
    seen = []

    def handler(request):
        seen.append(request.url.path)
        if request.url.path.endswith("b.pdf"):
            return httpx.Response(200, content=b"%PDF-1.7 real")
        if request.url.path.endswith("c.pdf"):
            return httpx.Response(200, content=b"<html>not a pdf</html>")
        return httpx.Response(307, text="JavaScript is required")  # the firewall challenge

    client = httpx.Client(transport=httpx.MockTransport(handler))
    got, failed = pdfs.download(delay=0, client=client)
    assert (tmp_path / "pdfs" / "b.pdf").read_bytes().startswith(b"%PDF-")
    assert not (tmp_path / "pdfs" / "c.pdf").exists()  # a page pretending to be a PDF is refused
    assert "/uploads/d.pdf" in seen and (got, failed) == (2, 1)
    assert "/uploads/a.pdf" not in seen  # already downloaded: not requested again
