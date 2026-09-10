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
