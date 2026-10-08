from ingest.chunk import chunk_doc
from ingest.extract import extract_html

OXYGEN_GRID = """
<html><head><title>Fees | University of Cyberjaya</title></head><body><main>
<h3>Diploma Programme</h3>
<div class="ct-new-columns"><div><h4>Programme</h4></div><div><h4>Tuition Fees (RM)</h4></div><div><h4>Total Payable (RM)</h4></div></div>
<div class="oxy-dynamic-list">
 <div><div class="ct-new-columns"><div><span>Nursing</span></div><div><span>55,000</span></div><div><span>40,150</span></div></div></div>
 <div><div class="ct-new-columns"><div><span>Pharmacy</span></div><div><span>60,000</span></div><div><span>39,900</span></div></div></div>
</div>
<p>1. Fees are for the entire duration.<br>2. Registration fee is non-refundable.</p>
<nav>MENU SHOULD BE DROPPED</nav>
</main></body></html>
"""


def test_grid_rows_become_one_markdown_table_in_order():
    title, md, _ = extract_html(OXYGEN_GRID, "u")
    assert title == "Fees"
    assert "| Programme | Tuition Fees (RM) | Total Payable (RM) |" in md
    assert "| Nursing | 55,000 | 40,150 |" in md and "| Pharmacy | 60,000 | 39,900 |" in md
    assert md.count("| Programme |") == 1  # rows merged into a single table
    assert "MENU SHOULD BE DROPPED" not in md


def test_br_separated_notes_keep_line_breaks():
    _, md, _ = extract_html(OXYGEN_GRID, "u")
    assert "1. Fees are for the entire duration.\n2. Registration fee" in md


def test_fee_table_denormalised_into_row_chunks():
    _, md, _ = extract_html(OXYGEN_GRID, "u")
    chunks = chunk_doc({"url": "u", "title": "Fees", "doc_type": "page", "markdown": md, "lastmod": None})
    rows = [c for c in chunks if c["metadata"].get("kind") == "fee_row"]
    assert {r["metadata"]["programme"] for r in rows} == {"Nursing", "Pharmacy"}
    nursing = next(r for r in rows if r["metadata"]["programme"] == "Nursing")
    assert "Total Payable (RM): 40,150" in nursing["content"] and nursing["content"].startswith("Fees")
