-- Hybrid search that still works when the embedding service is unavailable (quota / outage):
-- pass NULL as the query embedding and only the full-text leg runs. Same signature as before.
-- The full-text leg matches ANY meaningful word of the question (OR), ranked by how many match.
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
    where query_embedding is not null
      and (doc_types is null or d.doc_type = any(doc_types))
    order by c.embedding <=> query_embedding
    limit candidate_count
  ),
  -- Natural-language questions: match ANY meaningful word (websearch_to_tsquery would require ALL of them and return
  -- nothing for "what are the fees for nursing"), and rank passages that match more words higher.
  terms as (
    select to_tsquery('simple', nullif(string_agg(quote_literal(l), ' | '), '')) as q
    from unnest(tsvector_to_array(to_tsvector('english', query_text))) l
  ),
  lexical as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, terms.q) desc) as r
    from chunks c
    join documents d on d.id = c.document_id, terms
    where terms.q is not null
      and c.fts @@ terms.q
      and (doc_types is null or d.doc_type = any(doc_types))
    order by ts_rank_cd(c.fts, terms.q) desc
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
