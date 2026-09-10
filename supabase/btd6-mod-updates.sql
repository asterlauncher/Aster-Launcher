-- Allow a BTD6 mod creator to replace only their own catalog submission.
-- The replacement returns to pending review and is hidden until approved.

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

revoke all on function public.aster_update_btd6_submission(uuid,text,text,text,text,text,text,text,bigint,jsonb) from public;
grant execute on function public.aster_update_btd6_submission(uuid,text,text,text,text,text,text,text,bigint,jsonb) to authenticated;
