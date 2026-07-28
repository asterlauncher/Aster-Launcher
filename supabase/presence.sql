-- Run this entire file in Supabase: SQL Editor -> New query -> Run.
-- It replaces the previous anonymous-auth version and does not create Auth users.

drop function if exists public.launcher_presence_heartbeat(text);
drop function if exists public.launcher_presence_leave();
drop table if exists public.launcher_presence;

create table public.launcher_presence (
  client_id uuid primary key,
  last_seen timestamptz not null default now(),
  launcher_version text not null default 'unknown'
);

alter table public.launcher_presence enable row level security;
revoke all on table public.launcher_presence from anon, authenticated;

create or replace function public.launcher_presence_heartbeat(
  p_client_id uuid,
  p_launcher_version text default 'unknown'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  online_total bigint;
begin
  if p_client_id is null then
    raise exception 'A client ID is required';
  end if;

  delete from public.launcher_presence
  where last_seen < now() - interval '90 seconds';

  insert into public.launcher_presence (client_id, last_seen, launcher_version)
  values (
    p_client_id,
    now(),
    left(coalesce(nullif(trim(p_launcher_version), ''), 'unknown'), 32)
  )
  on conflict (client_id) do update
  set
    last_seen = excluded.last_seen,
    launcher_version = excluded.launcher_version;

  select count(*)
  into online_total
  from public.launcher_presence
  where last_seen >= now() - interval '90 seconds';

  return online_total;
end;
$$;

create or replace function public.launcher_presence_leave(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_client_id is not null then
    delete from public.launcher_presence where client_id = p_client_id;
  end if;
end;
$$;

revoke all on function public.launcher_presence_heartbeat(uuid, text) from public;
revoke all on function public.launcher_presence_leave(uuid) from public;
grant execute on function public.launcher_presence_heartbeat(uuid, text) to anon, authenticated;
grant execute on function public.launcher_presence_leave(uuid) to anon, authenticated;
