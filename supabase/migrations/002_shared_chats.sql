-- Shared conversation snapshots ("Share" button). A snapshot is immutable, public-by-link, expires, and can be
-- deleted by its creator: only a hash of the delete token is stored.
create table if not exists shared_chats (
  id                text primary key,                          -- random URL-safe token, not guessable
  snapshot          jsonb not null,                            -- {title, messages:[{role, content, quote?, sources[]}]}
  delete_token_hash text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '90 days'
);
create index if not exists shared_chats_expires_idx on shared_chats (expires_at);
alter table shared_chats enable row level security;          -- the API uses the service role; browsers never query directly
