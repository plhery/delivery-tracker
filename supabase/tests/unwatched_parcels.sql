\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, is_anonymous) values
  ('f2000000-0000-4000-8000-000000000001', 'quiet@example.com', false),
  ('f2000000-0000-4000-8000-000000000002', 'browser@example.com', false),
  ('f2000000-0000-4000-8000-000000000003', 'phone@example.com', false),
  ('f2000000-0000-4000-8000-000000000004', 'activity@example.com', false),
  ('f2000000-0000-4000-8000-000000000005', 'email@example.com', false),
  ('f2000000-0000-4000-8000-000000000006', 'reader@example.com', false);
insert into auth.sessions (id, user_id)
values ('f2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000004');

-- Only the server asks which parcels nobody is waiting for, and only an account records its own read.
do $$
begin
  if has_function_privilege('anon', 'public.unwatched_package_ids(timestamptz)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.unwatched_package_ids(timestamptz)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.unwatched_package_ids(timestamptz)', 'EXECUTE') then
    raise exception 'Listing the unwatched parcels must be reserved to the server';
  end if;
  if has_function_privilege('anon', 'public.record_account_opened()', 'EXECUTE')
      or has_function_privilege('service_role', 'public.record_account_opened()', 'EXECUTE')
      or not has_function_privilege('authenticated', 'public.record_account_opened()', 'EXECUTE') then
    raise exception 'Recording a read must be reserved to signed-in accounts';
  end if;
  if has_table_privilege('anon', 'public.account_activity', 'SELECT')
      or has_table_privilege('authenticated', 'public.account_activity', 'SELECT')
      or has_table_privilege('authenticated', 'public.account_activity', 'INSERT')
      or has_table_privilege('authenticated', 'public.account_activity', 'UPDATE')
      or has_table_privilege('authenticated', 'public.account_activity', 'DELETE')
      or not has_table_privilege('service_role', 'public.account_activity', 'SELECT')
      or not (select relrowsecurity from pg_class where oid = 'public.account_activity'::regclass)
      or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_activity') then
    raise exception 'When an account opened its apps is readable outside the server';
  end if;
end;
$$;

create function pg_temp.parcel(p_user uuid, p_number text, p_stage text default 'in_transit')
returns uuid
language sql
as $$
  insert into public.packages (user_id, tracking_number, carrier, current_stage)
  values (p_user, p_number, 'unknown', p_stage)
  returning id;
$$;

-- The parcels of this test a scheduled sync would check hourly, opened meaning within the last hour.
create function pg_temp.unwatched()
returns text[]
language sql
as $$
  select coalesce(array_agg(package.tracking_number order by package.tracking_number), '{}')
  from public.unwatched_package_ids(now() - interval '1 hour') as quiet
  join public.packages as package on package.id = quiet.id
  where package.tracking_number like 'UNWATCHED%';
$$;

-- An account: what it switched on, the parcels it muted, and when its apps were last open.
do $$
declare
  quiet constant uuid := 'f2000000-0000-4000-8000-000000000001';
  browser constant uuid := 'f2000000-0000-4000-8000-000000000002';
  phone constant uuid := 'f2000000-0000-4000-8000-000000000003';
  activity constant uuid := 'f2000000-0000-4000-8000-000000000004';
  email constant uuid := 'f2000000-0000-4000-8000-000000000005';
  reader constant uuid := 'f2000000-0000-4000-8000-000000000006';
begin
  perform pg_temp.parcel(quiet, 'UNWATCHED01');
  -- A finished or archived parcel is not checked at all; one still to be delivered is.
  perform pg_temp.parcel(quiet, 'UNWATCHED02', 'delivered');
  perform pg_temp.parcel(quiet, 'UNWATCHED03');
  update public.packages set archived_at = now() where tracking_number = 'UNWATCHED03';
  perform pg_temp.parcel(quiet, 'UNWATCHED04', 'delivered');
  update public.packages set last_status_text = 'TO_BE_DELIVERED' where tracking_number = 'UNWATCHED04';

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (browser, 'https://fcm.googleapis.com/fcm/send/unwatched', 'k', 'a');
  perform pg_temp.parcel(browser, 'UNWATCHED10');
  perform pg_temp.parcel(browser, 'UNWATCHED11');
  update public.packages set notifications_muted = true where tracking_number = 'UNWATCHED11';

  insert into public.native_push_devices (user_id, token, environment) values (phone, repeat('ab', 32), 'production');
  perform pg_temp.parcel(phone, 'UNWATCHED20');
  perform pg_temp.parcel(phone, 'UNWATCHED21');
  update public.packages set notifications_muted = true where tracking_number = 'UNWATCHED21';

  -- A Live Activity follows a muted parcel too.
  insert into public.live_activity_devices (session_id, user_id, installation_id, token, environment, locale)
  values (activity, activity, 'f2000000-0000-4000-8000-0000000000a4', repeat('cd', 32), 'production', 'en');
  perform pg_temp.parcel(activity, 'UNWATCHED30');
  update public.packages set notifications_muted = true where tracking_number = 'UNWATCHED30';

  insert into public.notification_preferences (user_id, email_on_delivery, email_enabled_at) values (email, true, now());
  perform pg_temp.parcel(email, 'UNWATCHED40');
  perform pg_temp.parcel(email, 'UNWATCHED41');
  update public.packages set email_muted = true where tracking_number = 'UNWATCHED41';

  perform pg_temp.parcel(reader, 'UNWATCHED50');
  perform set_config('request.jwt.claim.sub', reader::text, true);
  perform public.record_account_opened();

  if pg_temp.unwatched() <> array['UNWATCHED01', 'UNWATCHED04', 'UNWATCHED11', 'UNWATCHED21', 'UNWATCHED41'] then
    raise exception 'Nobody would be waiting for %', pg_temp.unwatched();
  end if;

  -- A subscription, a phone or a Live Activity that was switched off reaches nobody, nor does an email that was declined.
  update public.push_subscriptions set disabled_at = now() where user_id = browser;
  update public.native_push_devices set disabled_at = now() where user_id = phone;
  update public.live_activity_devices set disabled_at = now() where user_id = activity;
  update public.notification_preferences set email_on_delivery = false where user_id = email;
  if pg_temp.unwatched() <> array['UNWATCHED01', 'UNWATCHED04', 'UNWATCHED10', 'UNWATCHED11', 'UNWATCHED20',
      'UNWATCHED21', 'UNWATCHED30', 'UNWATCHED40', 'UNWATCHED41'] then
    raise exception 'With everything switched off, nobody would be waiting for %', pg_temp.unwatched();
  end if;

  -- A read counts for an hour, and is recorded at most every five minutes.
  update public.account_activity set last_opened_at = now() - interval '61 minutes' where user_id = reader;
  if not 'UNWATCHED50' = any(pg_temp.unwatched()) then
    raise exception 'An account that left an hour ago keeps the full schedule';
  end if;
  update public.account_activity set last_opened_at = now() - interval '4 minutes' where user_id = reader;
  perform public.record_account_opened();
  if (select last_opened_at from public.account_activity where user_id = reader) <> now() - interval '4 minutes' then
    raise exception 'A read was recorded again within five minutes';
  end if;
  update public.account_activity set last_opened_at = now() - interval '6 minutes' where user_id = reader;
  perform public.record_account_opened();
  if (select last_opened_at from public.account_activity where user_id = reader) <> now()
      or 'UNWATCHED50' = any(pg_temp.unwatched()) then
    raise exception 'A read after five minutes was not recorded';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.record_account_opened();
  if (select count(*) from public.account_activity) <> 1 then
    raise exception 'A read without an account was recorded';
  end if;

  delete from auth.users where id = reader;
  if exists (select 1 from public.account_activity) then
    raise exception 'Deleting an account kept when it last opened its apps';
  end if;
end;
$$;

-- A link: opened lately, or with an alert that still reaches its browser.
do $$
declare
  quiet constant uuid := 'f2000000-0000-4000-8000-000000000001';
  lookup_link text;
  shared_link text;
  followed text[];
begin
  lookup_link := public.create_one_off_parcel('UNWATCHED60', 'unknown', null, null, repeat('a', 64))#>>'{link,id}';
  if 'UNWATCHED60' = any(pg_temp.unwatched()) then
    raise exception 'A lookup that was just made is checked hourly';
  end if;
  -- After an hour it is checked hourly, and it stays on the schedule for 24 hours.
  update public.parcel_links set last_opened_at = now() - interval '2 hours' where id = lookup_link;
  select array_agg(tracking_number) into followed from public.followed_one_off_packages(now() - interval '24 hours');
  if not 'UNWATCHED60' = any(pg_temp.unwatched()) or followed is distinct from array['UNWATCHED60'] then
    raise exception 'A lookup opened two hours ago is not checked hourly: followed %', followed;
  end if;
  perform public.add_parcel_link_alert(lookup_link, null, 'https://fcm.googleapis.com/fcm/send/unwatched-viewer', 'k', 'a', 'en', 'all');
  if 'UNWATCHED60' = any(pg_temp.unwatched()) then
    raise exception 'A lookup with an alert on is checked hourly';
  end if;
  update public.parcel_links set shared = false, stopped_at = now() where id = lookup_link;
  if not 'UNWATCHED60' = any(pg_temp.unwatched()) then
    raise exception 'A stopped link''s viewer keeps its parcel on the full schedule';
  end if;

  -- A quiet account's shared parcel keeps the full schedule while its link is opened; its other parcels do not.
  insert into public.parcel_links (package_id, created_by, last_opened_at)
  select id, quiet, now() - interval '2 hours' from public.packages where tracking_number = 'UNWATCHED01'
  returning id into shared_link;
  if not 'UNWATCHED01' = any(pg_temp.unwatched()) then
    raise exception 'A shared parcel nobody opened keeps the full schedule';
  end if;
  update public.parcel_links set last_opened_at = now() - interval '10 minutes' where id = shared_link;
  if 'UNWATCHED01' = any(pg_temp.unwatched()) or not 'UNWATCHED04' = any(pg_temp.unwatched()) then
    raise exception 'Opening a shared link did not put that parcel, and only it, on the full schedule';
  end if;
end;
$$;

rollback;
