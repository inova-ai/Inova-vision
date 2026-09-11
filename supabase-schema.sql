-- INOVA VISION 6.7.0
-- Run this once in Supabase Dashboard -> SQL Editor.
-- The application uses the server-side service role key for this table.

create table if not exists public.inova_jobs (
  id uuid primary key,
  job jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists inova_jobs_updated_at_idx
  on public.inova_jobs (updated_at desc);

-- Optional hardening: keep the table inaccessible to anon/authenticated clients.
alter table public.inova_jobs enable row level security;

-- No public policies are created intentionally. The Vercel server uses
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
