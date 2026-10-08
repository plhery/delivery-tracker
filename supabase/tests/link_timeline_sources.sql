\set ON_ERROR_STOP on
begin;

-- A link's events name their source, for the server alone: it tells Peek's
-- own "Tracking added" from the carrier's scans, and passes neither on.
do $$
declare
  link_id text;
  parcel uuid;
  sources text[];
begin
  if has_function_privilege('anon', 'public.parcel_link_view(text,text,boolean)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.parcel_link_view(text,text,boolean)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.parcel_link_view(text,text,boolean)', 'EXECUTE') then
    raise exception 'Reading a link must stay reserved to the server';
  end if;

  link_id := public.create_one_off_parcel('TIMELINE01', 'unknown', null, null, repeat('b', 64))#>>'{link,id}';
  select package_id into parcel from public.parcel_links where id = link_id;
  insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id)
  values (parcel, 'in_transit', 'Scan', now() - interval '2 days', 'swiss-post:scan');

  select array_agg(event->>'provider_event_id' order by event->>'occurred_at' desc) into sources
  from jsonb_array_elements(public.parcel_link_view(link_id)#>'{package,tracking_events}') as event;
  if sources is distinct from array['app:pending', 'swiss-post:scan'] then
    raise exception 'A link''s events do not name their source: %', sources;
  end if;
  select array_agg(event->>'provider_event_id' order by event->>'occurred_at' desc) into sources
  from jsonb_array_elements(public.public_parcel(link_id)#>'{package,tracking_events}') as event;
  if sources is distinct from array['app:pending', 'swiss-post:scan'] then
    raise exception 'A new lookup''s events do not name their source: %', sources;
  end if;
end;
$$;

rollback;
