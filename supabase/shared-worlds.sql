-- Aster Shared Worlds
-- Run this entire file once in Supabase -> SQL Editor after supabase/social.sql.
-- It is idempotent and keeps existing worlds and revisions.

begin;

create table if not exists public.shared_worlds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.social_profiles(user_id) on delete cascade,
  name text not null,
  minecraft_version text not null,
  loader text not null,
  source_instance_name text not null,
  source_world_name text not null,
  current_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_worlds_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint shared_worlds_version_length check (char_length(minecraft_version) between 1 and 40),
  constraint shared_worlds_loader_length check (char_length(loader) between 1 and 40),
  constraint shared_worlds_instance_length check (char_length(source_instance_name) between 1 and 120),
  constraint shared_worlds_world_length check (char_length(source_world_name) between 1 and 120)
);

create table if not exists public.shared_world_members (
  world_id uuid not null references public.shared_worlds(id) on delete cascade,
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  permission text not null default 'play',
  added_by uuid not null references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (world_id, user_id),
  constraint shared_world_members_permission check (permission in ('play', 'host', 'manage'))
);

create table if not exists public.shared_world_revisions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.shared_worlds(id) on delete cascade,
  revision_number bigint not null,
  uploader_id uuid not null references public.social_profiles(user_id) on delete cascade,
  storage_path text not null unique,
  sha256 text not null,
  encrypted_key text not null,
  byte_size bigint not null,
  modpack_manifest jsonb not null default '{}'::jsonb,
  server_settings jsonb not null default '{}'::jsonb,
  status text not null default 'uploading',
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  constraint shared_world_revisions_number unique (world_id, revision_number),
  constraint shared_world_revisions_sha check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  constraint shared_world_revisions_key_length check (char_length(encrypted_key) between 40 and 80),
  constraint shared_world_revisions_size check (byte_size between 1 and 1073741824),
  constraint shared_world_revisions_status check (status in ('uploading', 'ready'))
);

create table if not exists public.shared_world_host_leases (
  world_id uuid primary key references public.shared_worlds(id) on delete cascade,
  holder_id uuid not null references public.social_profiles(user_id) on delete cascade,
  lease_token uuid not null default gen_random_uuid(),
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists shared_world_members_user
  on public.shared_world_members (user_id, world_id);
create index if not exists shared_world_revisions_world
  on public.shared_world_revisions (world_id, revision_number desc);
create index if not exists shared_world_leases_expiry
  on public.shared_world_host_leases (expires_at);

alter table public.shared_worlds enable row level security;
alter table public.shared_world_members enable row level security;
alter table public.shared_world_revisions enable row level security;
alter table public.shared_world_host_leases enable row level security;

create or replace function public.shared_world_access_level(p_world_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when world.owner_id = p_user_id then 'owner'
    else (
      select member.permission
      from public.shared_world_members member
      where member.world_id = world.id and member.user_id = p_user_id
    )
  end
  from public.shared_worlds world
  where world.id = p_world_id
$$;

drop policy if exists "shared world participants can read worlds" on public.shared_worlds;
create policy "shared world participants can read worlds"
  on public.shared_worlds for select to authenticated
  using (public.shared_world_access_level(id) is not null);

drop policy if exists "shared world participants can read members" on public.shared_world_members;
create policy "shared world participants can read members"
  on public.shared_world_members for select to authenticated
  using (public.shared_world_access_level(world_id) is not null);

drop policy if exists "shared world participants can read revisions" on public.shared_world_revisions;
create policy "shared world participants can read revisions"
  on public.shared_world_revisions for select to authenticated
  using (
    (status = 'ready' and public.shared_world_access_level(world_id) is not null)
    or (status = 'uploading' and uploader_id = auth.uid())
  );

drop policy if exists "shared world participants can read leases" on public.shared_world_host_leases;
create policy "shared world participants can read leases"
  on public.shared_world_host_leases for select to authenticated
  using (public.shared_world_access_level(world_id) is not null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-worlds',
  'shared-worlds',
  false,
  1073741824,
  array['application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shared world participants can download snapshots" on storage.objects;
create policy "shared world participants can download snapshots"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'shared-worlds'
    and exists (
      select 1
      from public.shared_world_revisions revision
      where revision.storage_path = name
        and revision.status = 'ready'
        and public.shared_world_access_level(revision.world_id) is not null
    )
  );

drop policy if exists "shared world revision authors can upload snapshots" on storage.objects;
create policy "shared world revision authors can upload snapshots"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shared-worlds'
    and exists (
      select 1
      from public.shared_world_revisions revision
      where revision.storage_path = name
        and revision.uploader_id = auth.uid()
        and revision.status = 'uploading'
    )
  );

drop policy if exists "shared world revision authors can remove failed snapshots" on storage.objects;
create policy "shared world revision authors can remove failed snapshots"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'shared-worlds'
    and exists (
      select 1
      from public.shared_world_revisions revision
      where revision.storage_path = name
        and (
          revision.uploader_id = auth.uid()
          or public.shared_world_access_level(revision.world_id) in ('owner', 'manage')
        )
    )
  );

create or replace function public.shared_world_create(
  p_name text,
  p_minecraft_version text,
  p_loader text,
  p_instance_name text,
  p_world_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.shared_worlds (
    owner_id, name, minecraft_version, loader, source_instance_name, source_world_name
  ) values (
    auth.uid(),
    left(btrim(p_name), 80),
    left(btrim(p_minecraft_version), 40),
    left(btrim(p_loader), 40),
    left(btrim(p_instance_name), 120),
    left(btrim(p_world_name), 120)
  )
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.shared_world_share(
  p_world_id uuid,
  p_minecraft_name text,
  p_permission text default 'play'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  level text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  level := public.shared_world_access_level(p_world_id);
  if level not in ('owner', 'manage') then raise exception 'Manage permission required'; end if;
  if p_permission not in ('play', 'host', 'manage') then raise exception 'Invalid permission'; end if;

  select profile.user_id into target_id
  from public.social_profiles profile
  where profile.minecraft_name = btrim(p_minecraft_name)::citext;
  if target_id is null then raise exception 'Aster player not found'; end if;
  if target_id = auth.uid() then raise exception 'You already own or access this world'; end if;
  if not exists (
    select 1 from public.friendships friendship
    where (friendship.member_a = auth.uid() and friendship.member_b = target_id)
       or (friendship.member_b = auth.uid() and friendship.member_a = target_id)
  ) then
    raise exception 'Only Aster friends can receive a shared world';
  end if;

  insert into public.shared_world_members (world_id, user_id, permission, added_by)
  values (p_world_id, target_id, p_permission, auth.uid())
  on conflict (world_id, user_id) do update
  set permission = excluded.permission, added_by = auth.uid();
end;
$$;

create or replace function public.shared_world_remove_member(p_world_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_user_id = auth.uid() then
    delete from public.shared_world_members where world_id = p_world_id and user_id = auth.uid();
  elsif public.shared_world_access_level(p_world_id) in ('owner', 'manage') then
    delete from public.shared_world_members where world_id = p_world_id and user_id = p_user_id;
  else
    raise exception 'Manage permission required';
  end if;
end;
$$;

create or replace function public.shared_world_delete(p_world_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.shared_world_access_level(p_world_id) <> 'owner' then
    raise exception 'Only the owner can delete this shared world';
  end if;
  delete from storage.objects
  where bucket_id = 'shared-worlds'
    and name in (
      select revision.storage_path
      from public.shared_world_revisions revision
      where revision.world_id = p_world_id
    );
  delete from public.shared_worlds where id = p_world_id and owner_id = auth.uid();
end;
$$;

create or replace function public.shared_world_reserve_revision(
  p_world_id uuid,
  p_sha256 text,
  p_encrypted_key text,
  p_byte_size bigint,
  p_modpack_manifest jsonb default '{}'::jsonb,
  p_server_settings jsonb default '{}'::jsonb
)
returns table (revision_id uuid, revision_number bigint, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  level text;
  next_number bigint;
  next_id uuid := gen_random_uuid();
  next_path text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  level := public.shared_world_access_level(p_world_id);
  if level not in ('owner', 'host', 'manage') then raise exception 'Host permission required'; end if;

  perform 1 from public.shared_worlds where id = p_world_id for update;
  select coalesce(max(revision.revision_number), 0) + 1 into next_number
  from public.shared_world_revisions revision where revision.world_id = p_world_id;
  next_path := p_world_id::text || '/' || next_id::text || '.asterworld';

  insert into public.shared_world_revisions (
    id, world_id, revision_number, uploader_id, storage_path, sha256,
    encrypted_key, byte_size, modpack_manifest, server_settings
  ) values (
    next_id, p_world_id, next_number, auth.uid(), next_path, lower(p_sha256),
    p_encrypted_key, p_byte_size, coalesce(p_modpack_manifest, '{}'::jsonb),
    coalesce(p_server_settings, '{}'::jsonb)
  );
  return query select next_id, next_number, next_path;
end;
$$;

create or replace function public.shared_world_commit_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  record public.shared_world_revisions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into record from public.shared_world_revisions
  where id = p_revision_id and uploader_id = auth.uid() and status = 'uploading'
  for update;
  if record.id is null then raise exception 'Pending revision not found'; end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'shared-worlds' and object.name = record.storage_path
  ) then raise exception 'Snapshot upload is missing'; end if;

  update public.shared_world_revisions
  set status = 'ready', committed_at = now()
  where id = record.id;
  update public.shared_worlds
  set current_revision = record.revision_number, updated_at = now()
  where id = record.world_id;
end;
$$;

create or replace function public.shared_world_abort_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shared_world_revisions
  where id = p_revision_id and uploader_id = auth.uid() and status = 'uploading';
end;
$$;

create or replace function public.shared_world_acquire_host(p_world_id uuid)
returns table (lease_token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  level text;
  token uuid := gen_random_uuid();
  expiry timestamptz := now() + interval '2 minutes';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  level := public.shared_world_access_level(p_world_id);
  if level not in ('owner', 'host', 'manage') then raise exception 'Host permission required'; end if;
  delete from public.shared_world_host_leases
  where world_id = p_world_id and expires_at <= now();
  if exists (select 1 from public.shared_world_host_leases where world_id = p_world_id) then
    raise exception 'Another friend is already hosting this world';
  end if;
  insert into public.shared_world_host_leases (
    world_id, holder_id, lease_token, acquired_at, heartbeat_at, expires_at
  ) values (p_world_id, auth.uid(), token, now(), now(), expiry);
  return query select token, expiry;
end;
$$;

create or replace function public.shared_world_heartbeat(p_world_id uuid, p_lease_token uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  expiry timestamptz := now() + interval '2 minutes';
begin
  update public.shared_world_host_leases
  set heartbeat_at = now(), expires_at = expiry
  where world_id = p_world_id and holder_id = auth.uid()
    and lease_token = p_lease_token and expires_at > now();
  if not found then raise exception 'The shared-world host lock expired'; end if;
  return expiry;
end;
$$;

create or replace function public.shared_world_release_host(p_world_id uuid, p_lease_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shared_world_host_leases
  where world_id = p_world_id and holder_id = auth.uid() and lease_token = p_lease_token;
end;
$$;

create or replace function public.shared_world_list()
returns table (
  id uuid,
  name text,
  minecraft_version text,
  loader text,
  source_instance_name text,
  source_world_name text,
  access_level text,
  owner_name text,
  current_revision bigint,
  latest_revision jsonb,
  members jsonb,
  active_host jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    world.id,
    world.name,
    world.minecraft_version,
    world.loader,
    world.source_instance_name,
    world.source_world_name,
    public.shared_world_access_level(world.id),
    owner.minecraft_name::text,
    world.current_revision,
    (
      select jsonb_build_object(
        'id', revision.id,
        'number', revision.revision_number,
        'storagePath', revision.storage_path,
        'sha256', revision.sha256,
        'encryptionKey', revision.encrypted_key,
        'size', revision.byte_size,
        'modpackManifest', revision.modpack_manifest,
        'serverSettings', revision.server_settings,
        'createdAt', revision.committed_at
      )
      from public.shared_world_revisions revision
      where revision.world_id = world.id and revision.status = 'ready'
      order by revision.revision_number desc limit 1
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', member.user_id,
        'minecraftName', profile.minecraft_name::text,
        'permission', member.permission
      ) order by profile.minecraft_name)
      from public.shared_world_members member
      join public.social_profiles profile on profile.user_id = member.user_id
      where member.world_id = world.id
    ), '[]'::jsonb),
    (
      select jsonb_build_object(
        'minecraftName', profile.minecraft_name::text,
        'expiresAt', lease.expires_at
      )
      from public.shared_world_host_leases lease
      join public.social_profiles profile on profile.user_id = lease.holder_id
      where lease.world_id = world.id and lease.expires_at > now()
    ),
    world.updated_at
  from public.shared_worlds world
  join public.social_profiles owner on owner.user_id = world.owner_id
  where public.shared_world_access_level(world.id) is not null
  order by world.updated_at desc
$$;

create or replace function public.shared_world_revision_history(p_world_id uuid)
returns table (
  id uuid,
  number bigint,
  storage_path text,
  sha256 text,
  encryption_key text,
  size bigint,
  modpack_manifest jsonb,
  server_settings jsonb,
  created_at timestamptz,
  uploader_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    revision.id,
    revision.revision_number,
    revision.storage_path,
    revision.sha256,
    revision.encrypted_key,
    revision.byte_size,
    revision.modpack_manifest,
    revision.server_settings,
    revision.committed_at,
    profile.minecraft_name::text
  from public.shared_world_revisions revision
  join public.social_profiles profile on profile.user_id = revision.uploader_id
  where revision.world_id = p_world_id
    and revision.status = 'ready'
    and public.shared_world_access_level(p_world_id) is not null
  order by revision.revision_number desc
  limit 25
$$;

revoke all on table public.shared_worlds from public, anon, authenticated;
revoke all on table public.shared_world_members from public, anon, authenticated;
revoke all on table public.shared_world_revisions from public, anon, authenticated;
revoke all on table public.shared_world_host_leases from public, anon, authenticated;
grant select on public.shared_worlds, public.shared_world_members,
  public.shared_world_revisions, public.shared_world_host_leases to authenticated;

revoke all on function public.shared_world_access_level(uuid, uuid) from public;
revoke all on function public.shared_world_create(text, text, text, text, text) from public;
revoke all on function public.shared_world_share(uuid, text, text) from public;
revoke all on function public.shared_world_remove_member(uuid, uuid) from public;
revoke all on function public.shared_world_delete(uuid) from public;
revoke all on function public.shared_world_reserve_revision(uuid, text, text, bigint, jsonb, jsonb) from public;
revoke all on function public.shared_world_commit_revision(uuid) from public;
revoke all on function public.shared_world_abort_revision(uuid) from public;
revoke all on function public.shared_world_acquire_host(uuid) from public;
revoke all on function public.shared_world_heartbeat(uuid, uuid) from public;
revoke all on function public.shared_world_release_host(uuid, uuid) from public;
revoke all on function public.shared_world_list() from public;
revoke all on function public.shared_world_revision_history(uuid) from public;

grant execute on function public.shared_world_create(text, text, text, text, text) to authenticated;
grant execute on function public.shared_world_access_level(uuid, uuid) to authenticated;
grant execute on function public.shared_world_share(uuid, text, text) to authenticated;
grant execute on function public.shared_world_remove_member(uuid, uuid) to authenticated;
grant execute on function public.shared_world_delete(uuid) to authenticated;
grant execute on function public.shared_world_reserve_revision(uuid, text, text, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.shared_world_commit_revision(uuid) to authenticated;
grant execute on function public.shared_world_abort_revision(uuid) to authenticated;
grant execute on function public.shared_world_acquire_host(uuid) to authenticated;
grant execute on function public.shared_world_heartbeat(uuid, uuid) to authenticated;
grant execute on function public.shared_world_release_host(uuid, uuid) to authenticated;
grant execute on function public.shared_world_list() to authenticated;
grant execute on function public.shared_world_revision_history(uuid) to authenticated;

commit;

select
  to_regclass('public.shared_worlds') is not null as shared_worlds_installed,
  exists (select 1 from storage.buckets where id = 'shared-worlds') as private_bucket_installed,
  to_regprocedure('public.shared_world_acquire_host(uuid)') is not null as host_lock_installed;
