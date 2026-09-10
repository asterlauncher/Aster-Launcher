-- Aster BTD6 community catalog, private review queue and download storage.
-- Run after supabase/social.sql and supabase/btd6-mod-submissions.sql.

alter table public.btd6_mod_submissions add column if not exists description text not null default '';
alter table public.btd6_mod_submissions add column if not exists version text not null default '1.0.0';
alter table public.btd6_mod_submissions add column if not exists icon_storage_path text;
alter table public.btd6_mod_submissions add column if not exists download_count bigint not null default 0;

create index if not exists btd6_mod_catalog_status_created
  on public.btd6_mod_submissions (status, created_at desc);

create or replace function public.aster_is_btd6_moderator()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.aster_gift_admins admin where admin.user_id = auth.uid()
  );
$$;

create or replace function public.aster_record_btd6_download(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.btd6_mod_submissions
  set download_count = download_count + 1
  where id = p_submission_id and status = 'approved';
end;
$$;

create or replace function public.aster_update_btd6_submission(
  p_submission_id uuid,
  p_display_name text,
  p_description text,
  p_version text,
  p_file_name text,
  p_storage_path text,
  p_icon_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_risk_signals jsonb
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'Invalid mod name';
  end if;
  if char_length(coalesce(p_description, '')) > 600 then
    raise exception 'Invalid mod description';
  end if;
  if char_length(btrim(p_version)) not between 1 and 32 then
    raise exception 'Invalid mod version';
  end if;
  if p_file_name !~* '^[^/\\]+\.dll$' then raise exception 'Invalid DLL name'; end if;
  if p_storage_path not like auth.uid()::text || '/%' then raise exception 'Invalid storage path'; end if;
  if p_icon_storage_path is not null
     and p_icon_storage_path not like auth.uid()::text || '/%' then
    raise exception 'Invalid icon path';
  end if;
  if p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid file hash'; end if;
  if p_size_bytes not between 1 and 268435456 then raise exception 'Invalid file size'; end if;

  update public.btd6_mod_submissions
  set display_name = btrim(p_display_name),
      description = btrim(coalesce(p_description, '')),
      version = btrim(p_version),
      file_name = p_file_name,
      storage_path = p_storage_path,
      icon_storage_path = p_icon_storage_path,
      sha256 = p_sha256,
      size_bytes = p_size_bytes,
      risk_signals = coalesce(p_risk_signals, '[]'::jsonb),
      status = 'pending',
      moderator_note = null,
      reviewed_at = null
  where id = p_submission_id and owner_id = auth.uid();

  if not found then raise exception 'Only the mod creator can submit an update'; end if;
end;
$$;

alter table public.btd6_mod_submissions enable row level security;
revoke all on table public.btd6_mod_submissions from anon, authenticated;
grant select, insert, update, delete on table public.btd6_mod_submissions to authenticated;

drop policy if exists "btd6 submitters read own rows" on public.btd6_mod_submissions;
drop policy if exists "btd6 approved catalog is visible" on public.btd6_mod_submissions;
create policy "btd6 approved catalog is visible"
on public.btd6_mod_submissions for select to authenticated
using (status = 'approved' or owner_id = auth.uid() or public.aster_is_btd6_moderator());

drop policy if exists "btd6 submitters create pending rows" on public.btd6_mod_submissions;
create policy "btd6 submitters create pending rows"
on public.btd6_mod_submissions for insert to authenticated
with check (
  owner_id = auth.uid() and status = 'pending'
  and storage_path like auth.uid()::text || '/%'
  and (icon_storage_path is null or icon_storage_path like auth.uid()::text || '/%')
);

drop policy if exists "btd6 moderators update submissions" on public.btd6_mod_submissions;
create policy "btd6 moderators update submissions"
on public.btd6_mod_submissions for update to authenticated
using (public.aster_is_btd6_moderator())
with check (public.aster_is_btd6_moderator());

drop policy if exists "btd6 moderators delete submissions" on public.btd6_mod_submissions;
create policy "btd6 moderators delete submissions"
on public.btd6_mod_submissions for delete to authenticated
using (public.aster_is_btd6_moderator());

revoke all on function public.aster_is_btd6_moderator() from public;
revoke all on function public.aster_record_btd6_download(uuid) from public;
revoke all on function public.aster_update_btd6_submission(uuid,text,text,text,text,text,text,text,bigint,jsonb) from public;
grant execute on function public.aster_is_btd6_moderator() to authenticated;
grant execute on function public.aster_record_btd6_download(uuid) to authenticated;
grant execute on function public.aster_update_btd6_submission(uuid,text,text,text,text,text,text,text,bigint,jsonb) to authenticated;

update storage.buckets set
  public = false,
  file_size_limit = 268435456,
  allowed_mime_types = array[
    'application/x-msdownload', 'application/octet-stream',
    'image/png', 'image/jpeg', 'image/webp'
  ]
where id = 'btd6-mod-submissions';

drop policy if exists "btd6 submitters upload own files" on storage.objects;
create policy "btd6 submitters upload own files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'btd6-mod-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('dll', 'png', 'jpg', 'jpeg', 'webp')
);

drop policy if exists "btd6 catalog files can be downloaded" on storage.objects;
create policy "btd6 catalog files can be downloaded"
on storage.objects for select to authenticated
using (
  bucket_id = 'btd6-mod-submissions' and (
    public.aster_is_btd6_moderator()
    or (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.btd6_mod_submissions submission
      where (submission.storage_path = name or submission.icon_storage_path = name)
        and (submission.status = 'approved' or submission.owner_id = auth.uid())
    )
  )
);

drop policy if exists "btd6 submitters remove own pending files" on storage.objects;
create policy "btd6 submitters remove own pending files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'btd6-mod-submissions' and (
    public.aster_is_btd6_moderator()
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and not exists (
        select 1 from public.btd6_mod_submissions submission
        where submission.status = 'approved'
          and (submission.storage_path = name or submission.icon_storage_path = name)
      )
    )
  )
);

select
  to_regclass('public.btd6_mod_submissions') is not null as community_catalog_installed,
  exists(select 1 from storage.buckets where id = 'btd6-mod-submissions' and public = false)
    as private_submission_bucket_installed;
