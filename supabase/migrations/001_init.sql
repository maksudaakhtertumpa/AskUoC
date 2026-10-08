-- AskUoC schema: documents + chunks (pgvector + FTS), hybrid search RPC, logs.
-- Run in Supabase SQL editor (or `supabase db push`).

create extension if not exists vector;

create table if not exists documents (
  id            bigserial primary key,
  url           text not null unique,
  title         text,
  doc_type      text not null,               -- page | programme | post | funding | tribe_events | research | testimonials | pdf | faq
  published_at  timestamptz,
  content_hash  text not null,               -- sha256 of cleaned text; skip re-embed when unchanged
  updated_at    timestamptz not null default now()
);

create table if not exists chunks (
  id            bigserial primary key,
  document_id   bigint not null references documents(id) on delete cascade,
  chunk_index   int not null,
  content       text not null,               -- text shown to the LLM (includes title/breadcrumb prefix)
  metadata      jsonb not null default '{}', -- heading path, programme level, etc.
  embedding     vector(768) not null,        -- gemini-embedding-001 truncated to 768 dims
  fts           tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, chunk_index)
);

-- HNSW works without training data (unlike ivfflat) and suits a small, growing corpus.
create index if not exists chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_fts_gin on chunks using gin (fts);
create index if not exists documents_type_idx on documents (doc_type);

-- Hybrid retrieval: dense (cosine) + lexical (ts_rank_cd), fused with Reciprocal Rank Fusion.
-- rrf_k = 60 is the standard constant from the original RRF paper.
create or replace function match_chunks_hybrid(
  query_embedding vector(768),
  query_text      text,
  match_count     int default 20,
  candidate_count int default 40,
  doc_types       text[] default null,
  rrf_k           int default 60
)
returns table (
  chunk_id    bigint,
  document_id bigint,
  url         text,
  title       text,
  doc_type    text,
  content     text,
  metadata    jsonb,
  dense_rank  int,
  lexical_rank int,
  similarity  double precision,
  score       double precision
)
language sql stable
as $$
  with dense as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as r,
           1 - (c.embedding <=> query_embedding) as sim
    from chunks c
    join documents d on d.id = c.document_id
    where doc_types is null or d.doc_type = any(doc_types)
    order by c.embedding <=> query_embedding
    limit candidate_count
  ),
  lexical as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q) desc) as r
    from chunks c
    join documents d on d.id = c.document_id,
         websearch_to_tsquery('english', query_text) q
    where c.fts @@ q
      and (doc_types is null or d.doc_type = any(doc_types))
    order by ts_rank_cd(c.fts, q) desc
    limit candidate_count
  ),
  fused as (
    select coalesce(dense.id, lexical.id) as id,
           dense.r as dense_rank,
           lexical.r as lexical_rank,
           dense.sim as sim,
           coalesce(1.0 / (rrf_k + dense.r), 0) + coalesce(1.0 / (rrf_k + lexical.r), 0) as score
    from dense
    full outer join lexical on dense.id = lexical.id
  )
  select c.id, c.document_id, d.url, d.title, d.doc_type, c.content, c.metadata,
         f.dense_rank::int, f.lexical_rank::int, f.sim, f.score
  from fused f
  join chunks c on c.id = f.id
  join documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$$;

-- Analytics / feedback (no PII: only anonymous session id, no IPs stored).
create table if not exists chat_logs (
  id          bigserial primary key,
  thread_id   text not null,
  question    text not null,
  answer      text,
  route       text,                          -- retrieve | chitchat | refuse | fallback
  source_urls text[] default '{}',
  latency_ms  int,
  created_at  timestamptz not null default now()
);

create table if not exists feedback (
  id          bigserial primary key,
  chat_log_id bigint references chat_logs(id) on delete cascade,
  rating      smallint not null check (rating in (-1, 1)),
  comment     text,
  created_at  timestamptz not null default now()
);

-- Lock down: the API uses the service-role key server-side only; browsers never touch the DB.
alter table documents enable row level security;
alter table chunks    enable row level security;
alter table chat_logs enable row level security;
alter table feedback  enable row level security;
