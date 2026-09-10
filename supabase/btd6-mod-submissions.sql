-- Aster BTD6 community mod submission queue.
-- Run once in Supabase SQL Editor after the Aster Social foundation.
-- Files remain private and pending until a trusted moderator reviews them.

create table if not exists public.btd6_mod_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  file_name text not null check (file_name ~* '^[^/\\]+\.dll$'),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 268435456),
  risk_signals jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderator_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.btd6_mod_submissions enable row level security;
revoke all on table public.btd6_mod_submissions from anon, authenticated;
grant select, insert on table public.btd6_mod_submissions to authenticated;

drop policy if exists "btd6 submitters read own rows" on public.btd6_mod_submissions;
create policy "btd6 submitters read own rows"
on public.btd6_mod_submissions for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists "btd6 submitters create pending rows" on public.btd6_mod_submissions;
create policy "btd6 submitters create pending rows"
on public.btd6_mod_submissions for insert
to authenticated
with check (
  owner_id = auth.uid()
  and status = 'pending'
  and storage_path like auth.uid()::text || '/%'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'btd6-mod-submissions',
  'btd6-mod-submissions',
  false,
  268435456,
  array['application/x-msdownload', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "btd6 submitters upload own files" on storage.objects;
create policy "btd6 submitters upload own files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'btd6-mod-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) = 'dll'
);

drop policy if exists "btd6 submitters remove own pending files" on storage.objects;
create policy "btd6 submitters remove own pending files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'btd6-mod-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

select
  to_regclass('public.btd6_mod_submissions') is not null as submission_queue_installed,
  exists(select 1 from storage.buckets where id = 'btd6-mod-submissions' and public = false)
    as private_submission_bucket_installed;
