\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, is_anonymous) values
  ('f3000000-0000-4000-8000-000000000001', 'reader@example.com', false),
  ('f3000000-0000-4000-8000-000000000002', 'quiet@example.com', false),
  ('f3000000-0000-4000-8000-000000000003', 'activity@example.com', false);
insert into auth.sessions (id, user_id)
values ('f3000000-0000-4000-8000-000000000003', 'f3000000-0000-4000-8000-000000000003');

-- Only the server asks which parcels out for delivery are on screen.
do $$
begin
  if has_function_privilege('anon', 'public.viewed_delivery_ids(timestamptz)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.viewed_delivery_ids(timestamptz)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.viewed_delivery_ids(timestamptz)', 'EXECUTE') then
    raise exception 'Listing the parcels on screen must be reserved to the server';
  end if;
end;
$$;

create function pg_temp.parcel(p_user uuid, p_number text, p_stage text default 'out_for_delivery')
returns uuid
language sql
as $$
  insert into public.packages (user_id, tracking_number, carrier, current_stage)
  values (p_user, p_number, 'unknown', p_stage)
  returning id;
$$;

-- The parcels of this test on screen in the last ten minutes, as a scheduled sync asks.
create function pg_temp.viewed()
returns text[]
language sql
as $$
  select coalesce(array_agg(package.tracking_number order by package.tracking_number), '{}')
  from public.viewed_delivery_ids(now() - interval '10 minutes') as viewed
  join public.packages as package on package.id = viewed.id
  where package.tracking_number like 'VIEWED%';
$$;

do $$
declare
  reader constant uuid := 'f3000000-0000-4000-8000-000000000001';
  quiet constant uuid := 'f3000000-0000-4000-8000-000000000002';
  activity constant uuid := 'f3000000-0000-4000-8000-000000000003';
  link_id text;
  device uuid;
begin
  -- An account whose apps read its parcels: only its open parcels out for delivery.
  insert into public.account_activity (user_id, last_opened_at) values (reader, now() - interval '5 minutes');
  perform pg_temp.parcel(reader, 'VIEWED01');
  perform pg_temp.parcel(reader, 'VIEWED02', 'in_transit');
  perform pg_temp.parcel(reader, 'VIEWED03');
  update public.packages set archived_at = now() where tracking_number = 'VIEWED03';
  -- A quiet account's parcel, until one of its links is opened.
  perform pg_temp.parcel(quiet, 'VIEWED10');
  insert into public.parcel_links (package_id, created_by, last_opened_at)
  select id, quiet, now() - interval '20 minutes' from public.packages where tracking_number = 'VIEWED10'
  returning id into link_id;
  if pg_temp.viewed() <> array['VIEWED01'] then
    raise exception 'Only a parcel out for delivery its account just read is on screen: %', pg_temp.viewed();
  end if;
  update public.parcel_links set last_opened_at = now() - interval '5 minutes' where id = link_id;
  if pg_temp.viewed() <> array['VIEWED01', 'VIEWED10'] then
    raise exception 'A parcel whose link was just opened is not on screen: %', pg_temp.viewed();
  end if;

  -- A lookup without an account, opened when it was made.
  link_id := public.create_one_off_parcel('VIEWED20', 'unknown', null, null, repeat('c', 64))#>>'{link,id}';
  update public.packages set current_stage = 'out_for_delivery' where tracking_number = 'VIEWED20';
  if not 'VIEWED20' = any(pg_temp.viewed()) then
    raise exception 'A lookup out for delivery that was just made is not on screen';
  end if;
  update public.parcel_links set last_opened_at = now() - interval '20 minutes' where id = link_id;
  if 'VIEWED20' = any(pg_temp.viewed()) then
    raise exception 'A lookup nobody opened for twenty minutes is on screen';
  end if;

  -- A Live Activity shows its parcel on the lock screen until its device is switched off.
  insert into public.live_activity_devices (session_id, user_id, installation_id, token, environment, locale)
  values (activity, activity, 'f3000000-0000-4000-8000-0000000000a3', repeat('cd', 32), 'production', 'en')
  returning id into device;
  insert into public.live_activity_update_tokens (device_id, package_id, activity_id, token, environment, locale)
  values (device, pg_temp.parcel(activity, 'VIEWED30'), 'viewed-activity', repeat('12', 32), 'production', 'en');
  if not 'VIEWED30' = any(pg_temp.viewed()) then
    raise exception 'A parcel a Live Activity shows is not on screen';
  end if;
  update public.live_activity_devices set disabled_at = now() where id = device;

  -- An account that left its apps a quarter of an hour ago.
  update public.account_activity set last_opened_at = now() - interval '15 minutes' where user_id = reader;
  if pg_temp.viewed() <> array['VIEWED10'] then
    raise exception 'Parcels nobody has on screen are: %', pg_temp.viewed();
  end if;
end;
$$;

rollback;
