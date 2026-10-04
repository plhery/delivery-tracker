\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, is_anonymous) values
 ('d1000000-0000-4000-8000-000000000001', 'sharer@example.test', false),
 ('d1000000-0000-4000-8000-000000000002', 'other-sharer@example.test', false),
 ('d1000000-0000-4000-8000-000000000003', null, true);

-- Alerts and the functions behind sharing belong to the server; sharing a parcel of one's own to its account.
do $$
declare
  role_name text;
  relation text;
  privilege text;
  service_function text;
  account_function text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach relation in array array[
      'public.parcel_link_alerts', 'public.parcel_link_alert_deliveries', 'public.pending_parcel_link_alerts'
    ] loop
      foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name, relation, privilege) then
          raise exception '% may % %', role_name, privilege, relation;
        end if;
      end loop;
    end loop;
    foreach service_function in array array[
      'public.parcel_link_view(text,text,boolean)',
      'public.public_parcel(text,text,boolean)',
      'public.update_parcel_link(text,text,boolean,boolean,boolean,jsonb)',
      'public.add_parcel_link_alert(text,text,text,text,text,text,text)',
      'public.remove_parcel_link_alert(text,text)',
      'public.forget_expired_parcel_links()',
      'public.followed_one_off_packages(timestamptz)',
      'public.link_package_tracking(uuid,uuid)'
    ] loop
      if has_function_privilege(role_name, service_function, 'EXECUTE') then
        raise exception '% may execute %', role_name, service_function;
      end if;
    end loop;
  end loop;
  foreach account_function in array array[
    'public.owned_package_share(uuid)',
    'public.share_owned_package(uuid,boolean,boolean,jsonb)',
    'public.stop_owned_package_share(uuid)',
    'public.claim_parcel_link(text,text,text)'
  ] loop
    if not has_function_privilege('authenticated', account_function, 'EXECUTE')
        or has_function_privilege('anon', account_function, 'EXECUTE')
        or has_function_privilege('service_role', account_function, 'EXECUTE') then
      raise exception '% must be reserved to signed-in accounts', account_function;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.parcel_link_alerts'::regclass)
      or not (select relrowsecurity from pg_class where oid = 'public.parcel_link_alert_deliveries'::regclass)
      or exists (select 1 from pg_policies where tablename in ('parcel_link_alerts', 'parcel_link_alert_deliveries')) then
    raise exception 'Alerts are not closed to client roles by row-level security';
  end if;
end;
$$;

set local role service_role;

-- A lookup's link: what its owner changes, what stopping does, and who may still read it.
do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  answer jsonb;
  target_link text;
  target_package uuid;
begin
  answer := public.create_one_off_parcel('SHARETEST0001', 'unknown', null, null, key_a);
  target_link := answer#>>'{link,id}';
  target_package := (answer#>>'{package,id}')::uuid;
  perform set_config('share_test.lookup_link', target_link, true);
  perform set_config('share_test.lookup_package', target_package::text, true);
  if answer#>'{link,gift}' <> 'false' or answer#>'{link,stopped}' <> 'false' or answer#>'{link,shared}' <> 'false' then
    raise exception 'A new lookup is a gift, stopped or from an account: %', answer->'link';
  end if;

  -- A wrong key, no key and an unknown link change nothing and answer alike.
  -- Each answer is read on its own: a statement does not see what a function it calls changes.
  if public.update_parcel_link(target_link, key_b, true, true, false) is not null
      or public.update_parcel_link(target_link, null, true, true, false) is not null
      or public.update_parcel_link('unknownLink2', key_a, true, true, false) is not null then
    raise exception 'A link answered a change without its key';
  end if;
  if exists (select 1 from public.parcel_links where id = target_link and (show_number or gift or not shared)) then
    raise exception 'A link was changed without its key';
  end if;

  answer := public.update_parcel_link(target_link, key_a, true, true);
  if answer#>'{link,show_number}' <> 'true' or answer#>'{link,gift}' <> 'true' or answer#>'{link,stopped}' <> 'false'
      or answer#>'{link,owner}' <> 'true' or answer->'transition' <> 'null'
      or answer#>>'{package,tracking_number}' <> 'SHARETEST0001' then
    raise exception 'The owner could not change what the link shows: %', answer;
  end if;
  -- A value left out stays as it is.
  answer := public.update_parcel_link(target_link, key_a, p_gift => false);
  if answer#>'{link,show_number}' <> 'true' or answer#>'{link,gift}' <> 'false' then
    raise exception 'A value left out was changed: %', answer->'link';
  end if;

  -- Alerts: one from a viewer, one from the owner. Stopping ends the viewer's.
  if public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/viewer', 'k', 'a', 'en', 'all') <> 'added'
      or public.add_parcel_link_alert(target_link, key_a, 'https://fcm.googleapis.com/fcm/send/owner', 'k', 'a', 'de', 'delivery') <> 'added' then
    raise exception 'Alerts could not be turned on';
  end if;
  answer := public.update_parcel_link(target_link, key_a, p_shared => false);
  if answer->>'transition' <> 'stopped' or answer#>'{link,stopped}' <> 'true'
      or not exists (select 1 from public.parcel_links where id = target_link and not shared and stopped_at = now())
      or (select array_agg(endpoint) from public.parcel_link_alerts where link_id = answer#>>'{link,id}')
        is distinct from array['https://fcm.googleapis.com/fcm/send/owner'] then
    raise exception 'Stopping did not stop the sharing and its viewers'' alerts: %', answer;
  end if;
  -- Stopping twice is no transition.
  if public.update_parcel_link(target_link, key_a, p_shared => false)->'transition' <> 'null' then
    raise exception 'Stopping a stopped link was reported as a change';
  end if;

  -- A viewer learns only that the sharing stopped; the owner still reads the parcel.
  if public.parcel_link_view(target_link) <> '{"stopped":true}'
      or public.parcel_link_view(target_link, key_b, true) <> '{"stopped":true}'
      or public.parcel_link_view(target_link, key_a)#>>'{package,tracking_number}' <> 'SHARETEST0001'
      or public.parcel_link_view('unknownLink2') is not null then
    raise exception 'A stopped link is read wrongly';
  end if;
  -- A viewer's visit to a stopped link is not an opening.
  update public.parcel_links set last_opened_at = now() - interval '10 minutes' where id = target_link;
  perform public.parcel_link_view(target_link, null, true);
  if (select last_opened_at from public.parcel_links where id = target_link) <> now() - interval '10 minutes' then
    raise exception 'A visit to a stopped link was recorded as an opening';
  end if;
  -- The server before sharing gets nothing it cannot show: not a stopped link.
  if public.public_parcel(target_link) is not null or public.public_parcel(target_link, key_a) is null then
    raise exception 'The earlier reader shows a stopped link, or hides it from its owner';
  end if;
  -- Nor can a viewer turn an alert on, while the owner can.
  if public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/late', 'k', 'a', 'en', 'all') <> 'stopped'
      or public.add_parcel_link_alert(target_link, key_a, 'https://fcm.googleapis.com/fcm/send/owner', 'k2', 'a2', 'fr', 'all') <> 'updated' then
    raise exception 'A stopped link took a viewer''s alert, or refused its owner''s';
  end if;
  if (select count(*) from public.parcel_link_alerts) <> 1 or not exists (
    select 1 from public.parcel_link_alerts
    where endpoint = 'https://fcm.googleapis.com/fcm/send/owner' and p256dh = 'k2' and auth = 'a2'
      and locale = 'fr' and preset = 'all' and owner
  ) then
    raise exception 'Alerts of a stopped link are wrong';
  end if;

  answer := public.update_parcel_link(target_link, key_a, p_shared => true);
  if answer->>'transition' <> 'started' or answer#>'{link,stopped}' <> 'false'
      or not exists (select 1 from public.parcel_links where id = target_link and shared and stopped_at is null) then
    raise exception 'Sharing could not be resumed: %', answer;
  end if;
  begin
    update public.parcel_links set stopped_at = now() where id = target_link;
    raise exception 'A shared link with a stop date was accepted' using errcode = 'P0001';
  exception when check_violation then null; end;

  -- A gift before delivery: the earlier reader shows it to its owner only.
  perform public.update_parcel_link(target_link, key_a, p_gift => true);
  answer := public.update_parcel_link(target_link, key_a, p_show_number => false);
  if answer#>'{link,gift}' <> 'true' or answer#>'{link,show_number}' <> 'false' or answer#>'{link,stopped}' <> 'false' then
    raise exception 'A switch left out was changed: %', answer->'link';
  end if;
  if public.public_parcel(target_link) is not null or public.public_parcel(target_link, key_b) is not null
      or public.public_parcel(target_link, key_a) is null
      or public.parcel_link_view(target_link)#>'{link,gift}' <> 'true' then
    raise exception 'The earlier reader shows a gift on its way, or the new one does not';
  end if;
  update public.packages set current_stage = 'delivered' where id = target_package;
  if public.public_parcel(target_link) is null then
    raise exception 'The earlier reader hides a delivered gift';
  end if;
  update public.packages set current_stage = 'in_transit' where id = target_package;

  -- An expired link cannot be changed or alerted on, whatever the key.
  update public.parcel_links set created_at = now() - interval '200 days', last_opened_at = now() - interval '200 days'
  where id = target_link;
  update public.tracking_events set occurred_at = now() - interval '200 days' where package_id = target_package;
  if public.update_parcel_link(target_link, key_a, p_gift => false) is not null
      or public.add_parcel_link_alert(target_link, key_a, 'https://fcm.googleapis.com/fcm/send/expired', 'k', 'a', 'en', 'all') is not null
      or public.parcel_link_view(target_link, key_a) is not null then
    raise exception 'An expired link answered a change, an alert or a read';
  end if;
  if exists (select 1 from public.parcel_link_alerts where endpoint like '%/expired')
      or not exists (select 1 from public.parcel_links where id = target_link and gift) then
    raise exception 'An expired link was changed or alerted on';
  end if;
  update public.parcel_links set created_at = now(), last_opened_at = now() where id = target_link;
end;
$$;

-- Alerts: ten per link from viewers, the owner's apart, one per browser, none after the journey.
do $$
declare
  key_a constant text := repeat('a', 64);
  target_link constant text := current_setting('share_test.lookup_link');
  target_package constant uuid := current_setting('share_test.lookup_package');
  outcome text;
begin
  delete from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link');
  for n in 1..10 loop
    outcome := public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/cap-' || n, 'k', 'a', 'en', 'important');
    if outcome <> 'added' then raise exception 'Alert % of ten was refused: %', n, outcome; end if;
  end loop;
  outcome := public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/cap-11', 'k', 'a', 'en', 'all');
  if outcome <> 'full'
      or (select count(*) from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link')) <> 10 then
    raise exception 'An eleventh alert was accepted: %', outcome;
  end if;
  -- A browser that has one changes it, however full the link is; the owner's is counted apart.
  if public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/cap-3', 'k', 'a', 'pl', 'delivery') <> 'updated'
      or public.add_parcel_link_alert(target_link, key_a, 'https://fcm.googleapis.com/fcm/send/cap-owner', 'k', 'a', 'en', 'all') <> 'added' then
    raise exception 'An existing alert or the owner''s was refused by the cap';
  end if;
  if (select count(*) from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link')) <> 11
      or not exists (select 1 from public.parcel_link_alerts where endpoint like '%/cap-3' and locale = 'pl' and preset = 'delivery' and not owner)
      or not exists (select 1 from public.parcel_link_alerts where endpoint like '%/cap-owner' and owner) then
    raise exception 'A changed alert or the owner''s was stored wrongly';
  end if;
  begin
    insert into public.parcel_link_alerts (link_id, endpoint, p256dh, auth, locale, preset)
    values (target_link, 'https://fcm.googleapis.com/fcm/send/cap-3', 'k', 'a', 'en', 'all');
    raise exception 'A browser got two alerts for one link' using errcode = 'P0001';
  exception when unique_violation then null; end;
  begin
    insert into public.parcel_link_alerts (link_id, endpoint, p256dh, auth, locale, preset)
    values (target_link, 'https://fcm.googleapis.com/fcm/send/preset', 'k', 'a', 'en', 'everything');
    raise exception 'An unknown preset was stored' using errcode = 'P0001';
  exception when check_violation then null; end;

  -- Turning one off needs its endpoint, and the right link.
  if public.remove_parcel_link_alert(target_link, 'https://fcm.googleapis.com/fcm/send/unknown')
      or public.remove_parcel_link_alert('unknownLink2', 'https://fcm.googleapis.com/fcm/send/cap-1') then
    raise exception 'An alert was turned off without its endpoint or its link';
  end if;
  if (select count(*) from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link')) <> 11
      or not public.remove_parcel_link_alert(target_link, 'https://fcm.googleapis.com/fcm/send/cap-1') then
    raise exception 'Turning an alert off is wrong';
  end if;
  if (select count(*) from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link')) <> 10
      or exists (select 1 from public.parcel_link_alerts where endpoint like '%/cap-1') then
    raise exception 'An alert turned off is still there, or took others along';
  end if;

  -- A journey that is over takes no alert.
  update public.packages set current_stage = 'delivered' where id = target_package;
  outcome := public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/cap-1', 'k', 'a', 'en', 'all');
  if outcome <> 'finished' or exists (select 1 from public.parcel_link_alerts where endpoint like '%/cap-1') then
    raise exception 'A delivered parcel took an alert: %', outcome;
  end if;
  update public.packages set current_stage = 'in_transit' where id = target_package;
  delete from public.parcel_link_alerts where link_id = current_setting('share_test.lookup_link');
end;
$$;

-- The queue of scans to announce, and the scheduled sync of a parcel somebody waits on.
do $$
declare
  key_a constant text := repeat('a', 64);
  target_link constant text := current_setting('share_test.lookup_link');
  target_package constant uuid := current_setting('share_test.lookup_package');
  viewer_alert uuid;
  owner_alert uuid;
  new_event uuid;
  pending record;
  followed text[];
  purged jsonb;
begin
  perform public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/queue-viewer', 'k', 'a', 'it', 'delivery');
  perform public.add_parcel_link_alert(target_link, key_a, 'https://fcm.googleapis.com/fcm/send/queue-owner', 'k', 'a', 'en', 'all');
  update public.parcel_link_alerts set created_at = now() - interval '1 hour' where link_id = current_setting('share_test.lookup_link');
  select id into viewer_alert from public.parcel_link_alerts where endpoint like '%/queue-viewer';
  select id into owner_alert from public.parcel_link_alerts where endpoint like '%/queue-owner';
  -- Scans stored before the alert, the app's own rows and a pending row are not news.
  if exists (select 1 from public.pending_parcel_link_alerts) then
    raise exception 'An alert announces what was there before it';
  end if;
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at, created_at)
  values (target_package, 'test:before', 'accepted', 'Synthetic scan', now() - interval '3 hours', now() - interval '2 hours'),
    (target_package, 'app:carrier-changed', 'registered', 'Synthetic app row', now(), now()),
    (target_package, 'test:pending', 'pending', 'Synthetic pending row', now(), now());
  insert into public.tracking_events (package_id, provider_event_id, stage, description, location, occurred_at, raw_data)
  values (target_package, 'test:news', 'out_for_delivery', 'Synthetic scan', 'Example Town', now(), '{"time":"2026-10-02T08:00:00+02:00"}')
  returning id into new_event;
  update public.packages set expected_delivery = '2026-10-03' where id = target_package;

  if (select count(*) from public.pending_parcel_link_alerts) <> 2 then
    raise exception 'The queue holds % rows instead of one new scan for each alert', (select count(*) from public.pending_parcel_link_alerts);
  end if;
  select * into pending from public.pending_parcel_link_alerts where alert_id = viewer_alert;
  if pending.link_id <> target_link or pending.endpoint <> 'https://fcm.googleapis.com/fcm/send/queue-viewer'
      or pending.locale <> 'it' or pending.preset <> 'delivery' or pending.owner or not pending.gift
      or pending.event_id <> new_event or pending.package_id <> target_package or pending.stage <> 'out_for_delivery'
      or pending.location <> 'Example Town' or pending.package_stage <> 'in_transit' or pending.failures <> 0
      or pending.expected_delivery <> '2026-10-03' or not pending.expected_delivery_changed
      or not pending.event_has_time or pending.account_endpoint then
    raise exception 'A queued alert is wrong: %', to_jsonb(pending);
  end if;

  -- A handled scan leaves the queue, for its alert only.
  insert into public.parcel_link_alert_deliveries (alert_id, event_id) values (viewer_alert, new_event);
  if (select array_agg(alert_id) from public.pending_parcel_link_alerts) is distinct from array[owner_alert] then
    raise exception 'A handled scan is still queued, or left another alert''s queue';
  end if;
  delete from public.parcel_link_alert_deliveries;

  -- A stopped link announces to its owner only.
  update public.parcel_links set shared = false, stopped_at = now() where id = target_link;
  if (select array_agg(alert_id) from public.pending_parcel_link_alerts) is distinct from array[owner_alert] then
    raise exception 'A stopped link still announces to its viewers';
  end if;
  update public.parcel_links set shared = true, stopped_at = null where id = target_link;

  -- A parcel somebody waits on stays on the schedule after its link was last opened; a stopped link's viewer does not count.
  update public.parcel_links set last_opened_at = now() - interval '3 days' where id = target_link;
  perform public.create_one_off_parcel('SHARETEST0002', 'unknown', null, null, key_a);
  update public.parcel_links set last_opened_at = now() - interval '3 days'
  where package_id = (select id from public.packages where tracking_number = 'SHARETEST0002');
  select array_agg(tracking_number) into followed from public.followed_one_off_packages(now() - interval '24 hours');
  if followed is distinct from array['SHARETEST0001'] then
    raise exception 'Scheduled sync would follow % instead of the parcel with an alert', followed;
  end if;
  delete from public.parcel_link_alerts where id = owner_alert;
  update public.parcel_links set shared = false, stopped_at = now() where id = target_link;
  if exists (select 1 from public.followed_one_off_packages(now() - interval '24 hours')) then
    raise exception 'A stopped link''s viewer keeps its parcel on the schedule';
  end if;
  update public.parcel_links set shared = true, stopped_at = null where id = target_link;
  update public.packages set current_stage = 'delivered' where id = target_package;
  if exists (select 1 from public.followed_one_off_packages(now() - interval '24 hours')) then
    raise exception 'A delivered parcel with an alert stays on the schedule';
  end if;

  -- The maintenance pass ends the alerts of a finished journey, once nothing waits to be announced.
  purged := public.forget_expired_parcel_links();
  if purged <> '{"links":0,"packages":0,"stopped":0,"alerts":0}'
      or not exists (select 1 from public.parcel_link_alerts where id = viewer_alert) then
    raise exception 'An alert with a scan to announce was ended: %', purged;
  end if;
  insert into public.parcel_link_alert_deliveries (alert_id, event_id) values (viewer_alert, new_event);
  purged := public.forget_expired_parcel_links();
  if purged <> '{"links":0,"packages":0,"stopped":0,"alerts":1}'
      or exists (select 1 from public.parcel_link_alerts where id = viewer_alert)
      or exists (select 1 from public.parcel_link_alert_deliveries) then
    raise exception 'The alert of a finished journey was kept: %', purged;
  end if;
  update public.packages set current_stage = 'in_transit' where id = target_package;

  -- Alerts and what they handled go with their link, and handled scans with their scan.
  perform public.add_parcel_link_alert(target_link, null, 'https://fcm.googleapis.com/fcm/send/cascade', 'k', 'a', 'en', 'all');
  insert into public.parcel_link_alert_deliveries (alert_id, event_id)
  select id, new_event from public.parcel_link_alerts where endpoint like '%/cascade';
  delete from public.tracking_events where id = new_event;
  if exists (select 1 from public.parcel_link_alert_deliveries) then
    raise exception 'A handled scan outlived its scan';
  end if;
  purged := public.forget_parcel_link(target_link, key_a);
  if purged <> '{"links":1,"packages":1}' or exists (select 1 from public.parcel_link_alerts) then
    raise exception 'Alerts outlived their link: %', purged;
  end if;
  delete from public.packages where tracking_number like 'SHARETEST%';
end;
$$;

-- Parcels of two accounts, one of them shared already by a link kept from a lookup.
do $$
declare
  sharer constant uuid := 'd1000000-0000-4000-8000-000000000001';
  other constant uuid := 'd1000000-0000-4000-8000-000000000002';
  target_link text;
begin
  insert into public.packages (id, user_id, tracking_number, label, carrier, current_stage) values
    ('d2000000-0000-4000-8000-000000000001', sharer, 'SHARETEST0101', 'Private name', 'unknown', 'in_transit'),
    ('d2000000-0000-4000-8000-000000000002', sharer, 'SHARETEST0102', '', 'unknown', 'in_transit'),
    ('d2000000-0000-4000-8000-000000000003', other, 'SHARETEST0103', '', 'unknown', 'in_transit'),
    ('d2000000-0000-4000-8000-000000000004', sharer, 'SHARETEST0104', '', 'swiss-post', 'in_transit');
  insert into public.parcel_links (package_id, created_by, show_number)
  values ('d2000000-0000-4000-8000-000000000002', sharer, true) returning id into target_link;
  perform set_config('share_test.kept_link', target_link, true);
  -- A link another account made to a parcel is never its owner's share.
  insert into public.parcel_links (package_id, created_by)
  values ('d2000000-0000-4000-8000-000000000001', other) returning id into target_link;
  perform set_config('share_test.foreign_link', target_link, true);
end;
$$;

set local role authenticated;

do $$
declare
  first_parcel constant uuid := 'd2000000-0000-4000-8000-000000000001';
  kept_parcel constant uuid := 'd2000000-0000-4000-8000-000000000002';
  others_parcel constant uuid := 'd2000000-0000-4000-8000-000000000003';
  answer jsonb;
  first_link text;
  second_link text;
begin
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
  begin
    perform count(*) from public.parcel_link_alerts;
    raise exception 'A signed-in account can read alerts' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.pending_parcel_link_alerts;
    raise exception 'A signed-in account can read the alert queue' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.parcel_link_view(current_setting('share_test.kept_link'));
    raise exception 'A signed-in account can call the server''s link reader' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;

  -- Nothing shared yet; sharing makes one link, and sharing again changes that link.
  if public.owned_package_share(first_parcel) is not null then
    raise exception 'A parcel never shared has a link';
  end if;
  answer := public.share_owned_package(first_parcel);
  first_link := answer->>'id';
  if answer->'created' <> 'true' or answer->'show_number' <> 'false' or answer->'gift' <> 'false'
      or first_link = current_setting('share_test.foreign_link')
      or first_link !~ '^[2-9A-HJ-NP-Za-km-z]{12}$' or (answer->>'created_at')::timestamptz <> now() then
    raise exception 'Sharing did not make a link: %', answer;
  end if;
  answer := public.share_owned_package(first_parcel, true, true);
  if answer->>'id' <> first_link or answer->'created' <> 'false' or answer->'show_number' <> 'true' or answer->'gift' <> 'true' then
    raise exception 'Sharing again did not change the live link: %', answer;
  end if;
  answer := public.share_owned_package(first_parcel, p_gift => false);
  if answer->>'id' <> first_link or answer->'show_number' <> 'true' or answer->'gift' <> 'false' then
    raise exception 'A value left out was changed: %', answer;
  end if;
  if public.owned_package_share(first_parcel) <> answer - 'created' then
    raise exception 'The live link reads %', public.owned_package_share(first_parcel);
  end if;
  -- A link kept from a lookup is the parcel's live link.
  if public.owned_package_share(kept_parcel)->>'id' <> current_setting('share_test.kept_link')
      or public.share_owned_package(kept_parcel, p_gift => true)->>'id' <> current_setting('share_test.kept_link') then
    raise exception 'A kept lookup''s link is not the parcel''s share';
  end if;

  -- Another account's parcel, and an unknown one, look like no parcel.
  foreach answer in array array[to_jsonb(others_parcel), to_jsonb('d2000000-0000-4000-8000-0000000000ff'::uuid)] loop
    begin
      perform public.owned_package_share((answer#>>'{}')::uuid);
      raise exception 'Another account''s share was read' using errcode = 'P0001';
    exception when sqlstate 'P0002' then if sqlerrm <> 'Package not found' then raise; end if; end;
    begin
      perform public.share_owned_package((answer#>>'{}')::uuid, true, false);
      raise exception 'Another account''s parcel was shared' using errcode = 'P0001';
    exception when sqlstate 'P0002' then if sqlerrm <> 'Package not found' then raise; end if; end;
    begin
      perform public.stop_owned_package_share((answer#>>'{}')::uuid);
      raise exception 'Another account''s sharing was stopped' using errcode = 'P0001';
    exception when sqlstate 'P0002' then if sqlerrm <> 'Package not found' then raise; end if; end;
  end loop;

  -- The second account, with the first one's parcel.
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
  begin
    perform public.share_owned_package(first_parcel, true, false);
    raise exception 'A second account shared another''s parcel' using errcode = 'P0001';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.stop_owned_package_share(first_parcel);
    raise exception 'A second account stopped another''s sharing' using errcode = 'P0001';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.owned_package_share(first_parcel);
    raise exception 'A second account read another''s share' using errcode = 'P0001';
  exception when sqlstate 'P0002' then null; end;
  -- Its own parcel is its own to share.
  if public.share_owned_package(others_parcel)->'created' <> 'true' then
    raise exception 'The second account could not share its own parcel';
  end if;

  -- An anonymous session, or none, shares nothing.
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
  begin
    perform public.share_owned_package(first_parcel);
    raise exception 'An anonymous session shared a parcel' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.stop_owned_package_share(first_parcel);
    raise exception 'Sharing was stopped without a session' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.owned_package_share(first_parcel);
    raise exception 'A share was read without a session' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;

  -- Stopping leaves the link behind as a stopped one; sharing again makes another.
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
  if not public.stop_owned_package_share(first_parcel) or public.stop_owned_package_share(first_parcel) then
    raise exception 'Sharing could not be stopped, or was stopped twice';
  end if;
  if public.owned_package_share(first_parcel) is not null then
    raise exception 'A parcel whose sharing was stopped still has a live link';
  end if;
  answer := public.share_owned_package(first_parcel);
  second_link := answer->>'id';
  if answer->'created' <> 'true' or second_link = first_link or answer->'show_number' <> 'false' then
    raise exception 'Sharing again reused the stopped link: %', answer;
  end if;
  perform set_config('share_test.first_link', first_link, true);
  perform set_config('share_test.second_link', second_link, true);
end;
$$;

set local role service_role;

do $$
declare
  sharer constant uuid := 'd1000000-0000-4000-8000-000000000001';
  first_parcel constant uuid := 'd2000000-0000-4000-8000-000000000001';
  kept_parcel constant uuid := 'd2000000-0000-4000-8000-000000000002';
  merged_parcel constant uuid := 'd2000000-0000-4000-8000-000000000004';
  first_link constant text := current_setting('share_test.first_link');
  second_link constant text := current_setting('share_test.second_link');
  kept_link constant text := current_setting('share_test.kept_link');
  answer jsonb;
  new_event uuid;
begin
  -- One live link per parcel and account, however it is made; stopped ones do not count.
  if (select count(*) from public.parcel_links where package_id = first_parcel and created_by = sharer) <> 2
      or (select count(*) from public.parcel_links where package_id = first_parcel and created_by = sharer and shared) <> 1
      or not exists (select 1 from public.parcel_links where id = first_link and not shared and stopped_at = now()) then
    raise exception 'A parcel has other than one live link and one stopped link';
  end if;
  begin
    insert into public.parcel_links (package_id, created_by) values (first_parcel, sharer);
    raise exception 'A parcel got a second live link from its account' using errcode = 'P0001';
  exception when unique_violation then null; end;

  -- A stopped link tells its visitors so, has no owner, and shows its account's parcel to nobody.
  answer := public.parcel_link_view(second_link);
  if answer#>'{link,shared}' <> 'true' or answer#>'{link,owner}' <> 'false' or answer#>'{link,forget_at}' <> 'null'
      or answer#>'{link,stopped}' <> 'false' then
    raise exception 'An account''s live link reads %', answer->'link';
  end if;
  if public.parcel_link_view(first_link) <> '{"stopped":true}'
      or public.parcel_link_view(first_link, repeat('a', 64)) <> '{"stopped":true}'
      or public.update_parcel_link(second_link, repeat('a', 64), true) is not null
      or public.update_parcel_link(second_link, null, true) is not null then
    raise exception 'An account''s link was read after its stop, or changed with a key';
  end if;

  -- Stopping ends every alert of the link: an account's link has no owner key.
  perform public.add_parcel_link_alert(second_link, null, 'https://fcm.googleapis.com/fcm/send/account-link', 'k', 'a', 'en', 'all');
  update public.parcel_link_alerts set created_at = now() - interval '1 hour';
  -- The owner's own browser is marked, so it is not told twice.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, subscribed_at, disabled_at) values
    (sharer, 'https://fcm.googleapis.com/fcm/send/account-link', 'k', 'a', now() - interval '1 hour', null);
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
  values (first_parcel, 'test:news', 'in_transit', 'Synthetic scan', now()) returning id into new_event;
  if (select account_endpoint from public.pending_parcel_link_alerts where event_id = new_event) is distinct from true then
    raise exception 'An alert on the owner''s own browser is not marked';
  end if;
  update public.push_subscriptions set disabled_at = now() where endpoint like '%/account-link';
  if (select account_endpoint from public.pending_parcel_link_alerts where event_id = new_event) is distinct from false then
    raise exception 'A disabled account subscription still marks the alert';
  end if;
  update public.push_subscriptions set disabled_at = null, user_id = 'd1000000-0000-4000-8000-000000000002'
  where endpoint like '%/account-link';
  if (select account_endpoint from public.pending_parcel_link_alerts where event_id = new_event) is distinct from false then
    raise exception 'Another account''s subscription marks the alert';
  end if;
  delete from public.push_subscriptions where endpoint like '%/account-link';

  -- Stopped links from accounts are purged 30 days after their stop, live ones never.
  update public.parcel_links set stopped_at = now() - interval '29 days', created_at = now() - interval '200 days' where id = first_link;
  update public.parcel_links set created_at = now() - interval '200 days', last_opened_at = now() - interval '200 days' where id = second_link;
  if public.forget_expired_parcel_links() <> '{"links":0,"packages":0,"stopped":0,"alerts":0}' then
    raise exception 'A link stopped 29 days ago, or a live one, was purged';
  end if;
  update public.parcel_links set stopped_at = now() - interval '30 days' where id = first_link;
  -- Past its date it reads as unknown even before the purge.
  if public.parcel_link_view(first_link) is not null then
    raise exception 'A stopped link past its 30 days still answers';
  end if;
  answer := public.forget_expired_parcel_links();
  if answer <> '{"links":0,"packages":0,"stopped":1,"alerts":0}'
      or exists (select 1 from public.parcel_links where id = first_link)
      or not exists (select 1 from public.parcel_links where id = second_link)
      or not exists (select 1 from public.packages where id = first_parcel) then
    raise exception 'The purge of stopped links is wrong: %', answer;
  end if;

  -- Both legs of a journey shared by one account: merged, the delivery leg's link stays live.
  insert into public.parcel_links (package_id, created_by) values (merged_parcel, sharer);
  perform public.add_parcel_link_alert(kept_link, null, 'https://fcm.googleapis.com/fcm/send/merged', 'k', 'a', 'en', 'all');
  perform public.link_package_tracking(kept_parcel, merged_parcel);
  if (select count(*) from public.parcel_links where package_id = merged_parcel and created_by = sharer and shared) <> 1
      or not exists (select 1 from public.parcel_links where id = kept_link and package_id = merged_parcel and not shared and stopped_at = now())
      or exists (select 1 from public.parcel_link_alerts where link_id = kept_link) then
    raise exception 'Merging two shared legs left other than one live link';
  end if;
  -- Only one leg shared: its link follows the parcel, alerts included.
  insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
  values ('d2000000-0000-4000-8000-000000000005', sharer, 'SHARETEST0105', 'swiss-post', 'in_transit');
  perform public.link_package_tracking(first_parcel, 'd2000000-0000-4000-8000-000000000005');
  if not exists (
        select 1 from public.parcel_links
        where id = second_link and package_id = 'd2000000-0000-4000-8000-000000000005' and shared
      )
      or not exists (select 1 from public.parcel_link_alerts where link_id = second_link) then
    raise exception 'A shared leg''s link or alert did not follow the merged parcel';
  end if;
end;
$$;

set local role authenticated;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
  if not public.stop_owned_package_share('d2000000-0000-4000-8000-000000000005') then
    raise exception 'The sharing of a merged parcel could not be stopped';
  end if;
end;
$$;

set local role service_role;

do $$
begin
  if exists (select 1 from public.parcel_link_alerts where link_id = current_setting('share_test.second_link'))
      or not exists (
        select 1 from public.parcel_links
        where id = current_setting('share_test.second_link') and not shared and stopped_at = now()
      )
      or not exists (select 1 from public.parcel_links where id = current_setting('share_test.foreign_link') and shared) then
    raise exception 'Stopping an account''s sharing kept its alerts, or stopped another account''s link';
  end if;
end;
$$;

-- Keeping a parcel from a link: not from a stopped one, not a gift on its way.
do $$
declare
  sharer constant uuid := 'd1000000-0000-4000-8000-000000000001';
  key_a constant text := repeat('a', 64);
  answer jsonb;
  target_link text;
begin
  insert into public.packages (id, user_id, tracking_number, carrier, current_stage, carrier_data) values
    ('d2000000-0000-4000-8000-000000000011', sharer, 'SHARETEST0201', 'unknown', 'in_transit', '{"sender_name":"Example sender"}'),
    ('d2000000-0000-4000-8000-000000000012', sharer, 'SHARETEST0202', 'unknown', 'in_transit', '{}'),
    ('d2000000-0000-4000-8000-000000000013', sharer, 'SHARETEST0203', 'unknown', 'delivered', '{}');
  insert into public.parcel_links (package_id, created_by, show_number, gift)
  values ('d2000000-0000-4000-8000-000000000011', sharer, true, true) returning id into target_link;
  perform set_config('share_test.gift_link', target_link, true);
  insert into public.parcel_links (package_id, created_by, show_number, shared, stopped_at)
  values ('d2000000-0000-4000-8000-000000000012', sharer, true, false, now()) returning id into target_link;
  perform set_config('share_test.stopped_link', target_link, true);
  insert into public.parcel_links (package_id, created_by, show_number, gift)
  values ('d2000000-0000-4000-8000-000000000013', sharer, true, true) returning id into target_link;
  perform set_config('share_test.delivered_gift_link', target_link, true);

  -- A lookup shared by two devices, with an alert on the link its key holder keeps.
  answer := public.create_one_off_parcel('SHARETEST0204', 'unknown', null, null, key_a);
  perform set_config('share_test.copy_link', answer#>>'{link,id}', true);
  perform public.create_one_off_parcel('SHARETEST0204', 'unknown', null, null, repeat('b', 64));
  perform public.add_parcel_link_alert(answer#>>'{link,id}', key_a, 'https://fcm.googleapis.com/fcm/send/copied', 'k', 'a', 'en', 'all');
  update public.parcel_link_alerts set created_at = now() - interval '1 hour' where endpoint like '%/copied';
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at, created_at)
  values ((answer#>>'{package,id}')::uuid, 'test:scan', 'in_transit', 'Synthetic scan', now() - interval '2 hours', now() - interval '2 hours');
  -- A stopped lookup stays its owner's to keep.
  answer := public.create_one_off_parcel('SHARETEST0205', 'unknown', null, null, key_a);
  perform public.update_parcel_link(answer#>>'{link,id}', key_a, true, true, false);
  perform set_config('share_test.owner_stopped_link', answer#>>'{link,id}', true);
end;
$$;

set local role authenticated;

do $$
declare
  key_a constant text := repeat('a', 64);
  answer jsonb;
  attempt text;
begin
  perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
  foreach attempt in array array[current_setting('share_test.gift_link'), current_setting('share_test.stopped_link')] loop
    begin
      perform public.claim_parcel_link(attempt, null, 'Mine now');
      raise exception 'A gift on its way or a stopped link was kept' using errcode = 'P0001';
    exception when sqlstate 'P0002' then
      if sqlerrm <> 'Parcel unavailable' then raise; end if;
    end;
  end loop;
  if exists (select 1 from public.packages where tracking_number in ('SHARETEST0201', 'SHARETEST0202')) then
    raise exception 'A refused keep left a parcel in the account';
  end if;
  -- Delivered, the gift is a parcel like any other whose number is shown.
  answer := public.claim_parcel_link(current_setting('share_test.delivered_gift_link'), null, 'It arrived');
  if answer->>'outcome' <> 'kept' then
    raise exception 'A delivered gift could not be kept: %', answer;
  end if;
  -- The key holder keeps a lookup whatever it shows to others.
  answer := public.claim_parcel_link(current_setting('share_test.owner_stopped_link'), key_a);
  if answer->>'outcome' <> 'kept' then
    raise exception 'The owner of a stopped gift lookup could not keep it: %', answer;
  end if;
  answer := public.claim_parcel_link(current_setting('share_test.copy_link'), key_a);
  if answer->>'outcome' <> 'kept' then
    raise exception 'A shared lookup could not be kept: %', answer;
  end if;
  perform set_config('share_test.copy_package', answer->>'package_id', true);
end;
$$;

set local role service_role;

do $$
begin
  -- The scans copied with a kept parcel are not news to the alerts of its link.
  if not exists (
        select 1 from public.parcel_links
        where id = current_setting('share_test.copy_link') and package_id = current_setting('share_test.copy_package')::uuid
      )
      or (select count(*) from public.tracking_events where package_id = current_setting('share_test.copy_package')::uuid) <> 2
      or exists (select 1 from public.pending_parcel_link_alerts where link_id = current_setting('share_test.copy_link')) then
    raise exception 'A kept parcel''s copied scans are announced again';
  end if;
  -- A kept stopped lookup is a stopped link of the account: it has no live share.
  if not exists (
    select 1 from public.parcel_links
    where id = current_setting('share_test.owner_stopped_link') and created_by = 'd1000000-0000-4000-8000-000000000002'
      and not shared and stopped_at is not null and gift
  ) then
    raise exception 'A kept stopped lookup did not stay stopped';
  end if;
end;
$$;
rollback;
