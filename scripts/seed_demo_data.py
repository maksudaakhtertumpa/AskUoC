"""Write a small demo knowledge base (chunks.jsonl + embeddings.npy) for CI, e2e tests and local demos.

python scripts/seed_demo_data.py [--out data]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.ingestion.chunk import chunk_doc  # noqa: E402
from app.rag.embed import HashEmbedder  # noqa: E402

DOCS = [
    (
        "https://cyberjaya.edu.my/admission/fees/domestic-fees-structure",
        "Domestic Fees Structure",
        "page",
        """# Domestic Fees Structure

### Diploma Programme

| Programme | Tuition Fees + Resource Fees (RM) | Waiver (RM) | Total Payable (RM) |
|---|---|---|---|
| Information Technology | 30,000 + 675 | 9,000 | 22,675 |
| Nursing | 55,000 + 900 | 16,750 | 40,150 |
| Pharmacy | 60,000 + 900 | 22,000 | 39,900 |

1. Total payable fees include a non-refundable registration fee of RM1,000.
2. Fees stated are for the entire duration of the programme.""",
    ),
    (
        "https://cyberjaya.edu.my/programme/diploma-in-nursing",
        "Diploma in Nursing",
        "programme",
        """# Diploma in Nursing

## Overview
A three-year programme preparing students for a career as a registered nurse, with clinical placements in partner hospitals.

## Entry Requirement
SPM with credits in Bahasa Melayu, English, Mathematics and Science, plus a pass in a medical fitness check.

## Career Prospects
Staff nurse, community health nurse, or progression to the Bachelor of Nursing (Hons).""",
    ),
    (
        "https://cyberjaya.edu.my/programme/diploma-in-information-technology",
        "Diploma in Information Technology",
        "programme",
        """# Diploma in Information Technology

## Overview
Learn programming, networking, databases and web development in a hands-on three-year programme.

## Entry Requirement
SPM with at least a credit in Mathematics and a pass in English.""",
    ),
    (
        "https://cyberjaya.edu.my/funding/nursing-scholarship",
        "Nursing Scholarship",
        "funding",
        """# Nursing Scholarship

Up to 40% scholarship for the Diploma in Nursing programme, awarded on academic merit and a short interview.""",
    ),
    (
        "https://cyberjaya.edu.my/campus-life/student-accommodation",
        "Student Accommodation",
        "page",
        """# Student Accommodation

On-campus and partner residences with shared or single rooms. A monthly utility fee of RM150 applies to air-conditioned rooms.
The minimum stay is 12 months from the reserved check-in date.""",
    ),
    (
        "https://cyberjaya.edu.my/admission/international-admissions",
        "International Admissions",
        "page",
        """# International Admissions

International students apply online, submit certified academic transcripts, proof of English proficiency and a passport copy.
The university assists with the student pass application after an offer is accepted.""",
    ),
    (
        "https://cyberjaya.edu.my/university/contact",
        "Contact",
        "page",
        """# Contact

University of Cyberjaya, Persiaran Bestari, Cyber 11, 63000 Cyberjaya, Selangor. Admissions enquiries are answered on weekdays.""",
    ),
]


async def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    chunks = []
    for url, title, typ, md in DOCS:
        chunks += chunk_doc({"url": url, "title": title, "doc_type": typ, "markdown": md, "lastmod": None})
    vecs = await HashEmbedder(768).embed_documents([c["content"] for c in chunks])
    (out / "chunks.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in chunks) + "\n")
    np.save(out / "embeddings.npy", np.asarray(vecs, dtype=np.float32))
    print(f"seeded {len(chunks)} chunks from {len(DOCS)} documents -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data", type=Path)
    asyncio.run(main(ap.parse_args().out))
