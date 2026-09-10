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
