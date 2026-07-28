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
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(btrim(p_minecraft_name)) not between 3 and 16 then
    raise exception 'Invalid Minecraft name';
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
revoke all on function public.social_send_friend_request(text) from public;
revoke all on function public.social_respond_friend_request(uuid, boolean) from public;
revoke all on function public.social_cancel_friend_request(uuid) from public;
revoke all on function public.social_remove_friend(uuid) from public;

grant execute on function public.social_sync_profile(text, text) to authenticated;
grant execute on function public.social_send_friend_request(text) to authenticated;
grant execute on function public.social_respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.social_cancel_friend_request(uuid) to authenticated;
grant execute on function public.social_remove_friend(uuid) to authenticated;

grant select on public.social_profiles to authenticated;
grant select on public.friend_requests to authenticated;
grant select on public.friendships to authenticated;
grant select, insert on public.social_messages to authenticated;
