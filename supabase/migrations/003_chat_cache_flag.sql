-- Record whether an answer was served from the answer cache (drives the admin dashboard's cache hit rate).
alter table chat_logs add column if not exists cache text;
create index if not exists chat_logs_created_idx on chat_logs (created_at desc);
