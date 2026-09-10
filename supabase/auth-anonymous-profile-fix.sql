-- Standalone auth repair retained for reference.
-- For a complete installation, run ONLY supabase/social.sql instead. It now
-- contains Presence, Social, Chat, Gifts and this anonymous-auth repair.
--
-- Fix anonymous Aster Social sign-ins when an existing public.profiles trigger
-- requires raw_user_meta_data.username to be non-null.
--
-- This does not change Minecraft names or existing profiles. It only adds a
-- stable internal fallback name before a new auth.users row reaches the
-- project's existing profile trigger.

create or replace function public.aster_prepare_auth_profile_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  metadata jsonb;
  fallback_username text;
  fallback_email text;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fallback_username :=
    'aster_' || left(replace(new.id::text, '-', ''), 10);
  fallback_email :=
    fallback_username || '@anonymous.aster.local';

  -- Anonymous Supabase users normally have no email address. This project has
  -- a legacy public.profiles trigger whose email column is NOT NULL, so give
  -- only anonymous identities a unique internal placeholder. It is not a real
  -- address and no confirmation email is sent.
  if coalesce(new.is_anonymous, false)
     and nullif(btrim(new.email), '') is null then
    new.email := fallback_email;
  end if;

  if nullif(btrim(metadata ->> 'username'), '') is null then
    metadata := jsonb_set(
      metadata,
      '{username}',
      to_jsonb(fallback_username),
      true
    );
  end if;

  if nullif(btrim(metadata ->> 'user_name'), '') is null then
    metadata := jsonb_set(
      metadata,
      '{user_name}',
      to_jsonb(fallback_username),
      true
    );
  end if;

  if nullif(btrim(metadata ->> 'name'), '') is null then
    metadata := jsonb_set(
      metadata,
      '{name}',
      to_jsonb(fallback_username),
      true
    );
  end if;

  if nullif(btrim(metadata ->> 'email'), '') is null then
    metadata := jsonb_set(
      metadata,
      '{email}',
      to_jsonb(coalesce(nullif(btrim(new.email), ''), fallback_email)),
      true
    );
  end if;

  new.raw_user_meta_data := metadata;
  return new;
end;
$$;

drop trigger if exists aster_00_prepare_auth_profile_metadata on auth.users;
create trigger aster_00_prepare_auth_profile_metadata
before insert on auth.users
for each row
execute function public.aster_prepare_auth_profile_metadata();

revoke all on function public.aster_prepare_auth_profile_metadata() from public;

select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
order by action_timing, trigger_name;
