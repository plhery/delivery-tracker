\set ON_ERROR_STOP on

-- The links stored before sharing existed, right after the migration.
do $$
declare
  answer jsonb;
begin
  -- Every link is shared and no gift; of two links an account had to one parcel, the newest stays live.
  if not exists (select 1 from public.parcel_links where id = 'preShareLnk4' and shared and stopped_at is null and not gift)
      or not exists (select 1 from public.parcel_links where id = 'preShareLnk3' and shared and stopped_at is null and not gift)
      or not exists (select 1 from public.parcel_links where id = 'preShareLnk2' and not shared and stopped_at is not null and show_number) then
    raise exception 'Links from before sharing were not carried over';
  end if;

  -- The server before sharing keeps reading them, in the shape it knows.
  answer := public.public_parcel('preShareLnk4', repeat('c', 64), true);
  if answer#>'{link,owner}' <> 'true' or answer#>'{link,shared}' <> 'false' or answer#>'{link,show_number}' <> 'false'
      or answer#>>'{package,tracking_number}' <> 'PRESHARE0002' or jsonb_typeof(answer#>'{package,tracking_events}') <> 'array'
      or not (answer->'link' ?& array['id', 'created_at', 'forget_at']) then
    raise exception 'The earlier reader no longer reads a lookup: %', answer;
  end if;
  if public.public_parcel('preShareLnk4')#>'{link,owner}' <> 'false'
      or public.public_parcel('preShareLnk3')#>'{link,shared}' <> 'true'
      or public.public_parcel('preShareLnk2') is not null
      or public.public_parcel('unknownLink2') is not null then
    raise exception 'The earlier reader reads the links of an account wrongly';
  end if;
  -- So do its lookups and its purge.
  answer := public.create_one_off_parcel('PRESHARE0002', 'unknown', null, null, repeat('d', 64));
  if answer->'created' <> 'false' or answer#>'{link,owner}' <> 'true' or answer#>>'{package,id}' <> 'd0000000-0000-4000-8000-000000000003' then
    raise exception 'The earlier server''s lookup no longer reuses a stored parcel: %', answer;
  end if;
  answer := public.forget_expired_parcel_links();
  if not answer @> '{"links":0,"packages":0}' then
    raise exception 'The earlier server''s purge forgot %', answer;
  end if;
end;
$$;

delete from public.packages where tracking_number like 'PRESHARE%';
delete from auth.users where id = 'd0000000-0000-4000-8000-000000000001';
