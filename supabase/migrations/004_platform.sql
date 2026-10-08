-- Platform tables: accounts (roles), runtime settings, snapshots, audit log, synced conversations.
-- All tables have RLS enabled with no policies: the API connects with a privileged role, browsers never query directly.

create table if not exists accounts (
  username       text primary key,
  password_hash  text not null,
  role           text not null default 'user' check (role in ('user', 'staff', 'admin')),
  display_name   text not null default '',
  avatar         text not null default '',            -- small data URL (client-resized), optional
  disabled       boolean not null default false,
  pwv            integer not null default 1,           -- bumping it invalidates every session for the account
  created_at     timestamptz not null default now()
);

create table if not exists app_kv (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists snapshots (
  id          text primary key,
  meta        jsonb not null,
  data        bytea not null,
  created_at  timestamptz not null default now()
);

create table if not exists audit_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  detail      jsonb not null default '{}'
);
create index if not exists audit_log_created_idx on audit_log (created_at desc);

create table if not exists user_conversations (
  username    text not null references accounts (username) on delete cascade,
  id          text not null,
  updated_at  bigint not null,                         -- client clock (ms): last-write-wins merge
  data        jsonb not null,
  primary key (username, id)
);

alter table accounts           enable row level security;
alter table app_kv             enable row level security;
alter table snapshots          enable row level security;
alter table audit_log          enable row level security;
alter table user_conversations enable row level security;
