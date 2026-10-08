from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Hit:
    chunk_id: int
    url: str
    title: str
    doc_type: str
    content: str
    metadata: dict = field(default_factory=dict)
    dense_rank: int | None = None
    lexical_rank: int | None = None
    similarity: float | None = None  # cosine similarity of the dense match
    score: float = 0.0  # RRF (or reranked) score
    coverage: float = 0.0  # filled by the reranker

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Hit":
        return cls(**d)
