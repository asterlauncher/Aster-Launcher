-- Aster Launcher canonical Social backend setup.
-- Run this complete file in the Supabase SQL editor. It is repeatable.

-- Aster Launcher social foundation
-- Run this entire file once in the Supabase SQL editor.
-- Anonymous Supabase accounts are used as persistent launcher identities.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minecraft_id text not null,
  minecraft_name citext not null,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profiles_minecraft_id_length
    check (char_length(minecraft_id) between 1 and 64),
  constraint social_profiles_minecraft_name_length
    check (char_length(minecraft_name::text) between 3 and 16)
);

create unique index if not exists social_profiles_minecraft_id_unique
  on public.social_profiles (minecraft_id);
create unique index if not exists social_profiles_minecraft_name_unique
  on public.social_profiles (minecraft_name);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.social_profiles(user_id) on delete cascade,
  receiver_id uuid not null references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friend_requests_different_users check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_unique_pair
  on public.friend_requests (
    least(sender_id::text, receiver_id::text),
    greatest(sender_id::text, receiver_id::text)
  );

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.social_profiles(user_id) on delete cascade,
  member_b uuid not null references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_different_users check (member_a <> member_b),
  constraint friendships_canonical_order check (member_a::text < member_b::text),
  constraint friendships_unique_pair unique (member_a, member_b)
);

create table if not exists public.social_messages (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships(id) on delete cascade,
  sender_id uuid not null references public.social_profiles(user_id) on delete cascade,
  body text,
  attachment_kind text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  created_at timestamptz not null default now(),
  constraint social_messages_content
    check (
      (body is not null and char_length(btrim(body)) between 1 and 500)
      or (
        attachment_kind in ('screenshot', 'modpack')
        and char_length(attachment_path) between 10 and 500
        and char_length(attachment_name) between 1 and 180
        and char_length(attachment_mime) between 3 and 100
        and attachment_size between 1 and 262144000
      )
    )
);

-- Upgrade an existing Aster Social installation without deleting messages.
alter table public.social_messages alter column body drop not null;
alter table public.social_messages add column if not exists attachment_kind text;
alter table public.social_messages add column if not exists attachment_path text;
alter table public.social_messages add column if not exists attachment_name text;
alter table public.social_messages add column if not exists attachment_mime text;
alter table public.social_messages add column if not exists attachment_size bigint;
alter table public.social_messages
  drop constraint if exists social_messages_body_length;
alter table public.social_messages
  drop constraint if exists social_messages_content;
alter table public.social_messages
  add constraint social_messages_content
  check (
    (body is not null and char_length(btrim(body)) between 1 and 500)
    or (
      attachment_kind in ('screenshot', 'modpack')
      and char_length(attachment_path) between 10 and 500
      and char_length(attachment_name) between 1 and 180
      and char_length(attachment_mime) between 3 and 100
      and attachment_size between 1 and 262144000
    )
  );

create index if not exists social_messages_friendship_created
  on public.social_messages (friendship_id, created_at desc);
create unique index if not exists social_messages_attachment_path_unique
  on public.social_messages (attachment_path)
  where attachment_path is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  262144000,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.social_profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.social_messages enable row level security;

drop policy if exists "profiles are visible to signed in launchers" on public.social_profiles;
create policy "profiles are visible to signed in launchers"
  on public.social_profiles for select
  to authenticated
  using (true);

drop policy if exists "launchers create their own profile" on public.social_profiles;
create policy "launchers create their own profile"
  on public.social_profiles for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "launchers update their own profile" on public.social_profiles;
create policy "launchers update their own profile"
  on public.social_profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "request participants can read requests" on public.friend_requests;
create policy "request participants can read requests"
  on public.friend_requests for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

drop policy if exists "friendship members can read friendships" on public.friendships;
create policy "friendship members can read friendships"
  on public.friendships for select
  to authenticated
  using (member_a = auth.uid() or member_b = auth.uid());

drop policy if exists "friendship members can read messages" on public.social_messages;
create policy "friendship members can read messages"
  on public.social_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and (f.member_a = auth.uid() or f.member_b = auth.uid())
    )
  );

drop policy if exists "friendship members can send messages" on public.social_messages;
create policy "friendship members can send messages"
  on public.social_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and (
      attachment_path is null
      or attachment_path like
        friendship_id::text || '/' || auth.uid()::text || '/%'
    )
    and exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and (f.member_a = auth.uid() or f.member_b = auth.uid())
    )
  );

drop policy if exists "friendship members can read chat attachments" on storage.objects;
create policy "friendship members can read chat attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.friendships f
      where f.id::text = split_part(name, '/', 1)
        and (f.member_a = auth.uid() or f.member_b = auth.uid())
    )
  );

drop policy if exists "friendship members can upload chat attachments" on storage.objects;
create policy "friendship members can upload chat attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.friendships f
      where f.id::text = split_part(name, '/', 1)
        and (f.member_a = auth.uid() or f.member_b = auth.uid())
    )
  );

drop policy if exists "senders can delete chat attachments" on storage.objects;
create policy "senders can delete chat attachments"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and split_part(name, '/', 2) = auth.uid()::text
  );

create or replace function public.social_sync_profile(
  p_minecraft_id text,
  p_minecraft_name text
)
returns public.social_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.social_profiles;
  conflicting_profile public.social_profiles;
  conflicting_profile_has_social_data boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(btrim(p_minecraft_name)) not between 3 and 16 then
    raise exception 'Invalid Minecraft name';
  end if;
  if btrim(p_minecraft_name) !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'Invalid Minecraft name';
  end if;

  -- Installer updates retain the anonymous Supabase session. If Windows has
  -- removed that WebView profile, reclaim only an unused, inactive profile
  -- instead of leaving the Minecraft account permanently unable to connect.
  select * into conflicting_profile
  from public.social_profiles
  where user_id <> auth.uid()
    and (
      minecraft_id = btrim(p_minecraft_id)
      or minecraft_name = btrim(p_minecraft_name)::citext
    )
  order by updated_at desc
  limit 1
  for update;

  if conflicting_profile.user_id is not null then
    select
      exists (
        select 1 from public.friend_requests
        where sender_id = conflicting_profile.user_id
           or receiver_id = conflicting_profile.user_id
      )
      or exists (
        select 1 from public.friendships
        where member_a = conflicting_profile.user_id
           or member_b = conflicting_profile.user_id
      )
      or exists (
        select 1 from public.social_messages
        where sender_id = conflicting_profile.user_id
      )
    into conflicting_profile_has_social_data;

    if not conflicting_profile_has_social_data
       and conflicting_profile.last_seen < now() - interval '2 minutes' then
      delete from public.social_profiles
      where user_id = conflicting_profile.user_id;
    else
      raise exception
        'This Minecraft profile is connected to another active Aster Social session';
    end if;
  end if;

  insert into public.social_profiles (
    user_id, minecraft_id, minecraft_name, last_seen, updated_at
  )
  values (
    auth.uid(), btrim(p_minecraft_id), btrim(p_minecraft_name), now(), now()
  )
  on conflict (user_id) do update
  set minecraft_id = excluded.minecraft_id,
      minecraft_name = excluded.minecraft_name,
      last_seen = now(),
      updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.social_search_players(
  p_query text
)
returns table (
  user_id uuid,
  minecraft_id text,
  minecraft_name citext,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.user_id,
    profile.minecraft_id,
    profile.minecraft_name,
    profile.last_seen
  from public.social_profiles profile
  where auth.uid() is not null
    and profile.user_id <> auth.uid()
    and char_length(btrim(p_query)) between 2 and 16
    and btrim(p_query) ~ '^[A-Za-z0-9_]{2,16}$'
    and strpos(
      lower(profile.minecraft_name::text),
      lower(btrim(p_query))
    ) = 1
  order by
    (profile.last_seen > now() - interval '90 seconds') desc,
    profile.minecraft_name
  limit 8;
$$;

create or replace function public.social_send_friend_request(
  p_minecraft_name text
)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  request_result public.friend_requests;
  low_id uuid;
  high_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select user_id into target_id
  from public.social_profiles
  where minecraft_name = btrim(p_minecraft_name)::citext;

  if target_id is null then
    raise exception 'No Aster player with that Minecraft name was found';
  end if;
  if target_id = auth.uid() then
    raise exception 'You cannot add yourself';
  end if;

  low_id := least(auth.uid()::text, target_id::text)::uuid;
  high_id := greatest(auth.uid()::text, target_id::text)::uuid;

  if exists (
    select 1 from public.friendships
    where member_a = low_id and member_b = high_id
  ) then
    raise exception 'You are already friends';
  end if;

  insert into public.friend_requests (sender_id, receiver_id)
  values (auth.uid(), target_id)
  returning * into request_result;

  return request_result;
exception
  when unique_violation then
    raise exception 'A friend request between these players already exists';
end;
$$;

create or replace function public.social_respond_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.friend_requests;
  friendship_id uuid;
  low_id uuid;
  high_id uuid;
begin
  select * into request_row
  from public.friend_requests
  where id = p_request_id and receiver_id = auth.uid()
  for update;

  if request_row.id is null then
    raise exception 'Friend request was not found';
  end if;

  if p_accept then
    low_id := least(request_row.sender_id::text, request_row.receiver_id::text)::uuid;
    high_id := greatest(request_row.sender_id::text, request_row.receiver_id::text)::uuid;
    insert into public.friendships (member_a, member_b)
    values (low_id, high_id)
    on conflict (member_a, member_b) do update set member_a = excluded.member_a
    returning id into friendship_id;
  end if;

  delete from public.friend_requests where id = p_request_id;
  return friendship_id;
end;
$$;

create or replace function public.social_cancel_friend_request(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friend_requests
  where id = p_request_id and sender_id = auth.uid();
  if not found then
    raise exception 'Friend request was not found';
  end if;
end;
$$;

create or replace function public.social_remove_friend(
  p_friendship_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
  where id = p_friendship_id
    and (member_a = auth.uid() or member_b = auth.uid());
  if not found then
    raise exception 'Friendship was not found';
  end if;
end;
$$;

revoke all on function public.social_sync_profile(text, text) from public;
revoke all on function public.social_search_players(text) from public;
revoke all on function public.social_send_friend_request(text) from public;
revoke all on function public.social_respond_friend_request(uuid, boolean) from public;
revoke all on function public.social_cancel_friend_request(uuid) from public;
revoke all on function public.social_remove_friend(uuid) from public;

grant execute on function public.social_sync_profile(text, text) to authenticated;
grant execute on function public.social_search_players(text) to authenticated;
grant execute on function public.social_send_friend_request(text) to authenticated;
grant execute on function public.social_respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.social_cancel_friend_request(uuid) to authenticated;
grant execute on function public.social_remove_friend(uuid) to authenticated;

grant select on public.social_profiles to authenticated;
grant select on public.friend_requests to authenticated;
grant select on public.friendships to authenticated;
grant select, insert on public.social_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------
-- Standalone presence migration retained for reference.
-- For a complete installation, run ONLY supabase/social.sql instead. It now
-- contains Presence, Social, Chat, Gifts and the anonymous-auth repair.

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

-- ---------------------------------------------------------------------------
-- Gifts and Aster Credits
-- ---------------------------------------------------------------------------
-- Standalone gift migration retained for reference.
-- For a complete installation, run ONLY supabase/social.sql instead. It now
-- contains Presence, Social, Chat, Gifts and the anonymous-auth repair.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.aster_gift_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.aster_gift_admins (user_id)
select user_id
from public.social_profiles
where lower(minecraft_name::text) = 'synoi'
on conflict (user_id) do nothing;

create table if not exists public.aster_gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.social_profiles(user_id) on delete restrict,
  recipient_id uuid not null references public.social_profiles(user_id) on delete cascade,
  amount integer not null check (amount between 1 and 100000),
  title text not null check (char_length(btrim(title)) between 1 and 64),
  message text not null check (char_length(btrim(message)) between 1 and 280),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists aster_gifts_recipient_pending
  on public.aster_gifts (recipient_id, created_at)
  where claimed_at is null;

create table if not exists public.aster_wallets (
  user_id uuid primary key references public.social_profiles(user_id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.aster_gift_admins enable row level security;
alter table public.aster_gifts enable row level security;
alter table public.aster_wallets enable row level security;

drop policy if exists "recipients can read their gifts" on public.aster_gifts;
create policy "recipients can read their gifts"
  on public.aster_gifts for select
  to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "players can read their Aster wallet" on public.aster_wallets;
create policy "players can read their Aster wallet"
  on public.aster_wallets for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.aster_is_gift_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.aster_gift_admins admin
      where admin.user_id = auth.uid()
    );
$$;

create or replace function public.aster_send_gift(
  p_recipient_name text,
  p_amount integer,
  p_title text,
  p_message text
)
returns public.aster_gifts
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  gift_result public.aster_gifts;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1
    from public.aster_gift_admins admin
    where admin.user_id = auth.uid()
  ) then
    raise exception 'Only the Aster owner can send gifts';
  end if;
  if p_amount not between 1 and 100000 then
    raise exception 'Gift amount must be between 1 and 100000 AC';
  end if;
  if char_length(btrim(p_title)) not between 1 and 64 then
    raise exception 'Gift title must contain between 1 and 64 characters';
  end if;
  if char_length(btrim(p_message)) not between 1 and 280 then
    raise exception 'Gift message must contain between 1 and 280 characters';
  end if;

  select profile.user_id into target_id
  from public.social_profiles profile
  where profile.minecraft_name = btrim(p_recipient_name)::citext;

  if target_id is null then
    raise exception 'No Aster player with that Minecraft name was found';
  end if;

  insert into public.aster_gifts (
    sender_id,
    recipient_id,
    amount,
    title,
    message
  )
  values (
    auth.uid(),
    target_id,
    p_amount,
    btrim(p_title),
    btrim(p_message)
  )
  returning * into gift_result;

  return gift_result;
end;
$$;

create or replace function public.aster_claim_gift(
  p_gift_id uuid
)
returns table (
  amount integer,
  balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  gift_result public.aster_gifts;
  next_balance bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into gift_result
  from public.aster_gifts gift
  where gift.id = p_gift_id
    and gift.recipient_id = auth.uid()
  for update;

  if gift_result.id is null then
    raise exception 'Gift was not found';
  end if;
  if gift_result.claimed_at is not null then
    raise exception 'Gift was already claimed';
  end if;

  insert into public.aster_wallets (user_id, balance, updated_at)
  values (auth.uid(), gift_result.amount, now())
  on conflict (user_id) do update
  set balance = public.aster_wallets.balance + excluded.balance,
      updated_at = now()
  returning public.aster_wallets.balance into next_balance;

  update public.aster_gifts
  set claimed_at = now()
  where id = gift_result.id;

  return query select gift_result.amount, next_balance;
end;
$$;

revoke all on table public.aster_gift_admins from public, anon, authenticated;
revoke all on table public.aster_gifts from public, anon, authenticated;
revoke all on table public.aster_wallets from public, anon, authenticated;
revoke all on function public.aster_is_gift_admin() from public;
revoke all on function public.aster_send_gift(text, integer, text, text) from public;
revoke all on function public.aster_claim_gift(uuid) from public;

grant select on public.aster_gifts to authenticated;
grant select on public.aster_wallets to authenticated;
grant execute on function public.aster_is_gift_admin() to authenticated;
grant execute on function public.aster_send_gift(text, integer, text, text) to authenticated;
grant execute on function public.aster_claim_gift(uuid) to authenticated;

select
  profile.minecraft_name,
  admin.user_id,
  admin.created_at
from public.aster_gift_admins admin
join public.social_profiles profile on profile.user_id = admin.user_id;

-- ---------------------------------------------------------------------------
-- Anonymous authentication compatibility
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Stale-session recovery
-- ---------------------------------------------------------------------------
-- Aster Social stale-session recovery.
-- Run this migration after supabase/social.sql.
--
-- Supabase anonymous users are persisted locally. If that local session is ever
-- lost, Supabase creates a new auth user while the Minecraft UUID remains bound
-- to the previous one. This migration lets the same Minecraft UUID reclaim an
-- inactive profile without deleting its friends, messages or launcher data.

create or replace function public.social_sync_profile(
  p_minecraft_id text,
  p_minecraft_name text
)
returns public.social_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.social_profiles;
  current_profile public.social_profiles;
  conflicting_profile public.social_profiles;
  requested_id text := btrim(p_minecraft_id);
  requested_name text := btrim(p_minecraft_name);
  retired_id text;
  retired_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(requested_id) not between 1 and 64 then
    raise exception 'Invalid Minecraft profile ID';
  end if;
  if char_length(requested_name) not between 3 and 16
     or requested_name !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'Invalid Minecraft name';
  end if;

  select * into current_profile
  from public.social_profiles
  where user_id = auth.uid()
  for update;

  if current_profile.user_id is not null
     and current_profile.minecraft_id <> requested_id then
    raise exception
      'This Aster Social session is already connected to another Minecraft profile';
  end if;

  select * into conflicting_profile
  from public.social_profiles
  where user_id <> auth.uid()
    and (
      minecraft_id = requested_id
      or minecraft_name = requested_name::citext
    )
  order by (minecraft_id = requested_id) desc, updated_at desc
  limit 1
  for update;

  if conflicting_profile.user_id is not null then
    -- A name alone is not enough to take ownership. Minecraft UUID is the
    -- stable identity and remains the required recovery key.
    if conflicting_profile.minecraft_id <> requested_id then
      raise exception
        'This Minecraft name belongs to another Aster Social profile';
    end if;

    -- Keep two genuinely active launcher installations from racing each other.
    if conflicting_profile.last_seen >= now() - interval '2 minutes' then
      raise exception
        'This Minecraft profile is connected to another active Aster Social session';
    end if;

    -- The current auth identity must not already own a separate profile. This
    -- normally cannot happen, but refusing it avoids merging two players.
    if current_profile.user_id is not null then
      raise exception
        'This Aster Social session is already connected to another Minecraft profile';
    end if;

    retired_id := 'retired:' || conflicting_profile.user_id::text;
    retired_name := 'retired_' || left(replace(conflicting_profile.user_id::text, '-', ''), 8);

    -- Free the unique Minecraft UUID and name while the old profile continues
    -- to anchor all foreign keys during the transaction.
    update public.social_profiles
    set minecraft_id = retired_id,
        minecraft_name = retired_name::citext,
        updated_at = now()
    where user_id = conflicting_profile.user_id;

    insert into public.social_profiles (
      user_id,
      minecraft_id,
      minecraft_name,
      last_seen,
      created_at,
      updated_at
    ) values (
      auth.uid(),
      requested_id,
      requested_name,
      now(),
      conflicting_profile.created_at,
      now()
    )
    returning * into result;

    update public.friend_requests
    set sender_id = case
          when sender_id = conflicting_profile.user_id then auth.uid()
          else sender_id
        end,
        receiver_id = case
          when receiver_id = conflicting_profile.user_id then auth.uid()
          else receiver_id
        end
    where sender_id = conflicting_profile.user_id
       or receiver_id = conflicting_profile.user_id;

    -- Friendship pairs are stored in UUID text order. Recalculate both sides
    -- in one statement so the canonical-order check remains valid.
    update public.friendships
    set member_a = least(
          (case when member_a = conflicting_profile.user_id then auth.uid() else member_a end)::text,
          (case when member_b = conflicting_profile.user_id then auth.uid() else member_b end)::text
        )::uuid,
        member_b = greatest(
          (case when member_a = conflicting_profile.user_id then auth.uid() else member_a end)::text,
          (case when member_b = conflicting_profile.user_id then auth.uid() else member_b end)::text
        )::uuid
    where member_a = conflicting_profile.user_id
       or member_b = conflicting_profile.user_id;

    update public.social_messages
    set sender_id = auth.uid()
    where sender_id = conflicting_profile.user_id;

    if to_regclass('public.aster_gifts') is not null then
      execute $migration$
        update public.aster_gifts
        set sender_id = case when sender_id = $1 then $2 else sender_id end,
            recipient_id = case when recipient_id = $1 then $2 else recipient_id end
        where sender_id = $1 or recipient_id = $1
      $migration$ using conflicting_profile.user_id, auth.uid();
    end if;

    if to_regclass('public.aster_wallets') is not null then
      execute 'update public.aster_wallets set user_id = $2 where user_id = $1'
        using conflicting_profile.user_id, auth.uid();
    end if;

    if to_regclass('public.aster_gift_admins') is not null then
      execute $migration$
        insert into public.aster_gift_admins (user_id)
        select $2 where exists (
          select 1 from public.aster_gift_admins where user_id = $1
        )
        on conflict (user_id) do nothing
      $migration$ using conflicting_profile.user_id, auth.uid();
      execute 'delete from public.aster_gift_admins where user_id = $1'
        using conflicting_profile.user_id;
    end if;

    if to_regclass('public.btd6_mod_submissions') is not null then
      execute 'update public.btd6_mod_submissions set owner_id = $2 where owner_id = $1'
        using conflicting_profile.user_id, auth.uid();
    end if;

    if to_regclass('public.shared_worlds') is not null then
      execute 'update public.shared_worlds set owner_id = $2 where owner_id = $1'
        using conflicting_profile.user_id, auth.uid();
    end if;
    if to_regclass('public.shared_world_members') is not null then
      execute $migration$
        update public.shared_world_members
        set user_id = case when user_id = $1 then $2 else user_id end,
            added_by = case when added_by = $1 then $2 else added_by end
        where user_id = $1 or added_by = $1
      $migration$ using conflicting_profile.user_id, auth.uid();
    end if;
    if to_regclass('public.shared_world_revisions') is not null then
      execute 'update public.shared_world_revisions set uploader_id = $2 where uploader_id = $1'
        using conflicting_profile.user_id, auth.uid();
    end if;
    if to_regclass('public.shared_world_host_leases') is not null then
      execute 'update public.shared_world_host_leases set holder_id = $2 where holder_id = $1'
        using conflicting_profile.user_id, auth.uid();
    end if;

    delete from public.social_profiles
    where user_id = conflicting_profile.user_id;

    return result;
  end if;

  insert into public.social_profiles (
    user_id, minecraft_id, minecraft_name, last_seen, updated_at
  ) values (
    auth.uid(), requested_id, requested_name, now(), now()
  )
  on conflict (user_id) do update
  set minecraft_id = excluded.minecraft_id,
      minecraft_name = excluded.minecraft_name,
      last_seen = now(),
      updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.social_sync_profile(text, text) from public;
grant execute on function public.social_sync_profile(text, text) to authenticated;

-- A migrated BTD6 submission can keep its original private Storage path. Let
-- the migrated database owner access that object even when the path starts with
-- the retired auth UUID.
do $$
begin
  if to_regclass('public.btd6_mod_submissions') is not null
     and to_regprocedure('public.aster_is_btd6_moderator()') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'btd6_mod_submissions'
         and column_name = 'icon_storage_path'
     ) then
    execute 'drop policy if exists "btd6 catalog files can be downloaded" on storage.objects';
    execute $policy$
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
      )
    $policy$;
  end if;
end;
$$;

select 'Aster Social stale-session recovery installed' as result;
