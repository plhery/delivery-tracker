\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, is_anonymous) values
 ('c1000000-0000-4000-8000-000000000001', 'keeper@example.test', false),
 ('c1000000-0000-4000-8000-000000000002', 'second-keeper@example.test', false),
 ('c1000000-0000-4000-8000-000000000003', 'full-box@example.test', false),
 ('c1000000-0000-4000-8000-000000000004', null, true);

-- Links, lookup counters and every function behind them belong to the server.
do $$
declare
  role_name text;
  relation text;
  privilege text;
  service_function text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach relation in array array['public.parcel_links', 'public.public_lookup_usage'] loop
      foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name, relation, privilege) then
          raise exception '% may % %', role_name, privilege, relation;
        end if;
      end loop;
    end loop;
    foreach service_function in array array[
      'public.parcel_link_forget_at(public.parcel_links)',
      'public.claim_public_lookup(text,integer,integer)',
      'public.public_lookup_usage_summary()',
      'public.public_parcel(text,text,boolean)',
      'public.create_one_off_parcel(text,text,text,text,text)',
      'public.forget_parcel_link(text,text)',
      'public.forget_expired_parcel_links()',
      'public.followed_one_off_packages(timestamptz)',
      'public.link_package_tracking(uuid,uuid)',
      'private.new_parcel_link_id()',
      'private.lock_one_off_number(text)',
      'private.forget_orphaned_one_off(uuid)'
    ] loop
      if has_function_privilege(role_name, service_function, 'EXECUTE') then
        raise exception '% may execute %', role_name, service_function;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('authenticated', 'public.claim_parcel_link(text,text,text)', 'EXECUTE')
      or has_function_privilege('anon', 'public.claim_parcel_link(text,text,text)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.claim_parcel_link(text,text,text)', 'EXECUTE') then
    raise exception 'Keeping a parcel must be reserved to signed-in accounts';
  end if;
end;
$$;

set local role service_role;

-- Lookups: one parcel per number, carrier and inputs; one link per lookup.
do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  first jsonb;
  second jsonb;
  other jsonb;
  first_link text;
  second_link text;
  first_package uuid;
  opened timestamptz;
begin
  first := public.create_one_off_parcel('oneoff test-0001', 'unknown', null, null, key_a);
  first_link := first#>>'{link,id}';
  first_package := (first#>>'{package,id}')::uuid;
  if first->'created' <> 'true' or first#>'{link,owner}' <> 'true' or first#>'{link,shared}' <> 'false'
      or first#>'{link,show_number}' <> 'false' or first_link !~ '^[2-9A-HJ-NP-Za-km-z]{12}$'
      or first#>>'{package,tracking_number}' <> 'ONEOFFTEST0001' or first#>'{package,one_off}' <> 'true'
      or first#>'{package,user_id}' <> 'null' or first#>>'{package,label}' <> ''
      or jsonb_array_length(first#>'{package,tracking_events}') <> 1
      or (first#>>'{link,forget_at}')::timestamptz <> now() + interval '90 days' then
    raise exception 'A lookup did not create a one-off parcel and its link: %', first;
  end if;
  if first::text like '%' || key_a || '%' then
    raise exception 'A lookup answer carries the owner key hash';
  end if;

  second := public.create_one_off_parcel('ONEOFFTEST0001', 'unknown', null, null, key_b);
  second_link := second#>>'{link,id}';
  if second->'created' <> 'false' or (second#>>'{package,id}')::uuid <> first_package
      or second_link = first_link or second#>'{link,owner}' <> 'true' then
    raise exception 'The same lookup did not reuse the stored parcel: %', second;
  end if;
  other := public.create_one_off_parcel('ONEOFFTEST0001', 'dpd', null, '8000', key_a);
  if other->'created' <> 'true' or (other#>>'{package,id}')::uuid = first_package then
    raise exception 'A lookup with other inputs reused a parcel';
  end if;
  -- A carrier corrected since still answers the lookup it was filed under.
  update public.packages set carrier = 'dpd', carrier_data = '{"auto_changed_from":"unknown"}'
  where id = first_package;
  other := public.create_one_off_parcel('ONEOFFTEST0001', 'unknown', null, null, key_a);
  if other->'created' <> 'false' or (other#>>'{package,id}')::uuid <> first_package then
    raise exception 'A corrected parcel was looked up twice';
  end if;
  if not public.forget_parcel_link(other#>>'{link,id}', key_a) @> '{"links":1,"packages":0}' then
    raise exception 'An extra lookup could not be forgotten';
  end if;

  begin
    perform public.create_one_off_parcel('!!', 'unknown', null, null, key_a);
    raise exception 'An invalid number was looked up' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_one_off_parcel('ONEOFFTEST0002', 'not-a-carrier', null, null, key_a);
    raise exception 'An unknown carrier was looked up' using errcode = 'P0001';
  exception when check_violation then null; end;
  begin
    insert into public.parcel_links (package_id) values (first_package);
    raise exception 'A link with neither a key nor an account was accepted' using errcode = 'P0001';
  exception when check_violation then null; end;

  -- A refresh of a parcel without an owner can be queued; nothing else changed.
  insert into public.sync_jobs (package_id, kind, dedupe_key)
  values (first_package, 'package', 'package:' || first_package);
  begin
    insert into public.sync_jobs (kind) values ('package');
    raise exception 'A package job without a package was accepted' using errcode = 'P0001';
  exception when check_violation then null; end;
  begin
    insert into public.sync_jobs (package_id, kind) values (first_package, 'scheduled');
    raise exception 'A scheduled job with a package was accepted' using errcode = 'P0001';
  exception when check_violation then null; end;

  -- Reading: roles, unknown links, and when an opening is recorded.
  if public.public_parcel('unknownLink2') is not null then
    raise exception 'An unknown link returned a parcel';
  end if;
  if public.public_parcel(first_link)#>'{link,owner}' <> 'false'
      or public.public_parcel(first_link, key_b)#>'{link,owner}' <> 'false'
      or public.public_parcel(first_link, key_a)#>'{link,owner}' <> 'true' then
    raise exception 'The owner key did not decide the role';
  end if;
  update public.parcel_links set last_opened_at = now() - interval '10 minutes' where id = first_link;
  perform public.public_parcel(first_link);
  select last_opened_at into opened from public.parcel_links where id = first_link;
  if opened <> now() - interval '10 minutes' then
    raise exception 'A read that does not open the link moved its last opening';
  end if;
  perform public.public_parcel(first_link, null, true);
  select last_opened_at into opened from public.parcel_links where id = first_link;
  if opened <> now() then raise exception 'Opening a link was not recorded'; end if;
  update public.parcel_links set last_opened_at = now() - interval '2 minutes' where id = first_link;
  perform public.public_parcel(first_link, null, true);
  select last_opened_at into opened from public.parcel_links where id = first_link;
  if opened <> now() - interval '2 minutes' then
    raise exception 'An opening was recorded again within five minutes';
  end if;

  -- A later lookup of a stored parcel does not learn when the first one was made.
  update public.packages set created_at = now() - interval '3 days' where id = first_package;
  update public.tracking_events set occurred_at = now() - interval '3 days' where package_id = first_package;
  if (public.public_parcel(second_link)#>>'{package,tracking_events,0,occurred_at}')::timestamptz <> now() then
    raise exception 'The "Tracking added" row predates the link';
  end if;

  -- Forgetting on request: the key decides, and the parcel goes with its last link.
  if public.forget_parcel_link(first_link, key_b) <> '{"links":0,"packages":0}'
      or public.forget_parcel_link('unknownLink2', key_a) <> '{"links":0,"packages":0}'
      or public.forget_parcel_link(first_link, null) <> '{"links":0,"packages":0}'
      or not exists (select 1 from public.parcel_links where id = first_link) then
    raise exception 'A wrong key forgot a link';
  end if;
  -- Each answer is read on its own: a statement does not see what a function it calls deletes.
  other := public.forget_parcel_link(first_link, key_a);
  if other <> '{"links":1,"packages":0}'
      or not exists (select 1 from public.packages where id = first_package) then
    raise exception 'Forgetting one link removed a parcel another link still uses';
  end if;
  other := public.forget_parcel_link(second_link, key_b);
  if other <> '{"links":1,"packages":1}'
      or exists (select 1 from public.packages where id = first_package)
      or exists (select 1 from public.tracking_events where package_id = first_package)
      or exists (select 1 from public.sync_jobs where package_id = first_package) then
    raise exception 'The last link did not take its parcel along';
  end if;
  delete from public.packages where tracking_number = 'ONEOFFTEST0001';

  -- Link ids come from the table default, in the alphabet without lookalikes.
  insert into public.packages (id, user_id, one_off, tracking_number, carrier)
  values ('c2000000-0000-4000-8000-000000000001', null, true, 'ONEOFFIDS0001', 'unknown');
  insert into public.parcel_links (package_id, owner_key_hash)
  select 'c2000000-0000-4000-8000-000000000001', key_a from generate_series(1, 300);
  if exists (select 1 from public.parcel_links where id !~ '^[2-9A-HJ-NP-Za-km-z]{12}$')
      or (select count(distinct id) from public.parcel_links) <> 300
      or (select count(distinct symbol) from public.parcel_links, regexp_split_to_table(id, '') as symbol) <> 57 then
    raise exception 'Link ids do not use the whole alphabet, and only it';
  end if;
  delete from public.packages where id = 'c2000000-0000-4000-8000-000000000001';
  if exists (select 1 from public.parcel_links) then
    raise exception 'Links outlived their parcel';
  end if;
end;
$$;

-- Expiry: 30 days after delivery, 90 days without news, never for an account's link.
do $$
declare
  key_a constant text := repeat('a', 64);
  answer jsonb;
  link_id text;
  target_package uuid;
  kept text[] := '{}';
  expired text[] := '{}';
  scenario record;
begin
  for scenario in
    select * from (values
      -- number, stage, newest scan, lookup, last opening, forgotten
      ('ONEOFFEXPIRE01', 'delivered', interval '31 days', interval '40 days', interval '1 day', true),
      ('ONEOFFEXPIRE02', 'delivered', interval '31 days', interval '10 days', interval '10 days', false),
      ('ONEOFFEXPIRE03', 'delivered', interval '10 days', interval '40 days', interval '40 days', false),
      ('ONEOFFEXPIRE04', 'returned', interval '31 days', interval '40 days', interval '1 day', true),
      ('ONEOFFEXPIRE05', 'in_transit', interval '91 days', interval '100 days', interval '91 days', true),
      ('ONEOFFEXPIRE06', 'in_transit', interval '91 days', interval '100 days', interval '5 days', false),
      ('ONEOFFEXPIRE07', 'in_transit', interval '10 days', interval '100 days', interval '100 days', false)
    ) as scenarios(number, stage, scanned, looked_up, opened, forgotten)
  loop
    answer := public.create_one_off_parcel(scenario.number, 'unknown', null, null, key_a);
    link_id := answer#>>'{link,id}';
    target_package := (answer#>>'{package,id}')::uuid;
    update public.packages set current_stage = scenario.stage where id = target_package;
    update public.tracking_events set occurred_at = now() - interval '200 days' where package_id = target_package;
    insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
    values (target_package, 'test:latest', scenario.stage, 'Synthetic scan', now() - scenario.scanned);
    update public.parcel_links
    set created_at = now() - scenario.looked_up, last_opened_at = now() - scenario.opened
    where id = link_id;
    if scenario.forgotten then expired := expired || link_id; else kept := kept || link_id; end if;
  end loop;

  -- A forecast dated in the future is not news.
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
  select link.package_id, 'test:forecast', 'in_transit', 'Synthetic forecast', now() + interval '10 days'
  from public.parcel_links as link
  join public.packages as package on package.id = link.package_id
  where package.tracking_number = 'ONEOFFEXPIRE05';
  -- A second, older lookup of the parcel delivered 31 days ago expires alone.
  insert into public.parcel_links (package_id, owner_key_hash, created_at, last_opened_at)
  select id, repeat('b', 64), now() - interval '40 days', now() - interval '40 days'
  from public.packages where tracking_number = 'ONEOFFEXPIRE02'
  returning id into link_id;
  expired := expired || link_id;
  -- A link from an account has no forget date.
  insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
  values ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'ONEOFFEXPIRE08', 'unknown', 'delivered');
  update public.tracking_events set occurred_at = now() - interval '200 days'
  where package_id = 'c2000000-0000-4000-8000-000000000002';
  insert into public.parcel_links (package_id, created_by, created_at, last_opened_at)
  values ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', now() - interval '200 days', now() - interval '200 days')
  returning id into link_id;
  kept := kept || link_id;
  if public.public_parcel(link_id)#>'{link,forget_at}' <> 'null' or public.public_parcel(link_id)#>'{link,shared}' <> 'true' then
    raise exception 'A link from an account has a forget date';
  end if;

  -- A link past its date reads as unknown even before the purge, and opening it does not revive it.
  if public.public_parcel(expired[1], key_a, true) is not null or public.public_parcel(expired[3], null, true) is not null then
    raise exception 'An expired link was still readable';
  end if;
  if (public.public_parcel(kept[1])#>>'{link,forget_at}')::timestamptz <> now() + interval '20 days'
      or (public.public_parcel(kept[2])#>>'{link,forget_at}')::timestamptz <> now() + interval '20 days'
      or (public.public_parcel(kept[3])#>>'{link,forget_at}')::timestamptz <> now() + interval '85 days'
      or (public.public_parcel(kept[4])#>>'{link,forget_at}')::timestamptz <> now() + interval '80 days' then
    raise exception 'Forget dates do not follow the 30-day and 90-day rules';
  end if;

  answer := public.forget_expired_parcel_links();
  if answer <> '{"links":4,"packages":3,"stopped":0,"alerts":0}' then
    raise exception 'The purge forgot %', answer;
  end if;
  if exists (select 1 from public.parcel_links where id = any(expired))
      or (select count(*) from public.parcel_links where id = any(kept)) <> cardinality(kept)
      or exists (select 1 from public.packages where tracking_number in ('ONEOFFEXPIRE01', 'ONEOFFEXPIRE04', 'ONEOFFEXPIRE05'))
      or (select count(*) from public.packages where tracking_number like 'ONEOFFEXPIRE%') <> 5 then
    raise exception 'The purge did not honour the forget dates';
  end if;
  if public.forget_expired_parcel_links() <> '{"links":0,"packages":0,"stopped":0,"alerts":0}' then
    raise exception 'A second purge found more to forget';
  end if;
  delete from public.packages where tracking_number like 'ONEOFFEXPIRE%';
end;
$$;

-- Scheduled sync follows a one-off parcel only while a link was opened lately.
do $$
declare
  key_a constant text := repeat('a', 64);
  followed text[];
begin
  perform public.create_one_off_parcel('ONEOFFFOLLOW01', 'unknown', null, null, key_a);
  perform public.create_one_off_parcel('ONEOFFFOLLOW02', 'unknown', null, null, key_a);
  perform public.create_one_off_parcel('ONEOFFFOLLOW03', 'unknown', null, null, key_a);
  perform public.create_one_off_parcel('ONEOFFFOLLOW04', 'unknown', null, null, key_a);
  update public.packages set last_synced_at = now() - interval '1 hour' where tracking_number = 'ONEOFFFOLLOW01';
  update public.parcel_links set last_opened_at = now() - interval '25 hours'
  where package_id = (select id from public.packages where tracking_number = 'ONEOFFFOLLOW03');
  update public.packages set current_stage = 'delivered' where tracking_number = 'ONEOFFFOLLOW04';
  insert into public.packages (user_id, tracking_number, carrier)
  values ('c1000000-0000-4000-8000-000000000001', 'ONEOFFFOLLOW05', 'unknown');

  select array_agg(tracking_number) into followed
  from public.followed_one_off_packages(now() - interval '24 hours');
  if followed is distinct from array['ONEOFFFOLLOW02', 'ONEOFFFOLLOW01'] then
    raise exception 'Scheduled sync would follow %', followed;
  end if;
  delete from public.packages where tracking_number like 'ONEOFFFOLLOW%';
end;
$$;

-- Daily allowances: per client, then overall; a week of counters is kept.
do $$
declare
  first constant text := repeat('1', 64);
  answer jsonb;
  today constant date := (now() at time zone 'UTC')::date;
begin
  insert into public.public_lookup_usage (bucket, day, count) values
    ('global', today - 8, 5), (first, today - 8, 5),
    ('global', today - 1, 16), (repeat('5', 64), today - 1, 1), (repeat('6', 64), today - 1, 2),
    (repeat('7', 64), today - 1, 3), (repeat('8', 64), today - 1, 10), (repeat('9', 64), today - 1, 0);
  if public.public_lookup_usage_summary() <> '{"buckets":4,"p50":2,"p90":10,"max":10}' then
    raise exception 'Unexpected usage summary: %', public.public_lookup_usage_summary();
  end if;

  if public.claim_public_lookup(first, 2, 3) <> '{"allowed":true,"scope":null,"remaining":1}'
      or public.claim_public_lookup(first, 2, 3) <> '{"allowed":true,"scope":null,"remaining":0}' then
    raise exception 'A lookup within the allowance was refused';
  end if;
  answer := public.claim_public_lookup(first, 2, 3);
  if answer <> '{"allowed":false,"scope":"bucket","remaining":0}' then
    raise exception 'The per-client allowance was not enforced: %', answer;
  end if;
  if public.claim_public_lookup(repeat('2', 64), 2, 3) -> 'allowed' <> 'true' then
    raise exception 'Another client was refused';
  end if;
  answer := public.claim_public_lookup(repeat('3', 64), 2, 3);
  if answer <> '{"allowed":false,"scope":"global","remaining":2}' then
    raise exception 'The overall allowance was not enforced: %', answer;
  end if;
  if public.claim_public_lookup(repeat('3', 64), 2, 0) -> 'allowed' <> 'false' then
    raise exception 'A zero allowance still let a lookup through';
  end if;
  if (select count from public.public_lookup_usage where bucket = 'global' and day = today) <> 3
      or (select count from public.public_lookup_usage where bucket = first and day = today) <> 2
      or (select count from public.public_lookup_usage where bucket = repeat('3', 64) and day = today) <> 0
      or exists (select 1 from public.public_lookup_usage where day < today - 7) then
    raise exception 'Lookup counters are wrong or older than a week';
  end if;
  begin
    perform public.claim_public_lookup('192.0.2.1', 2, 3);
    raise exception 'A raw address was accepted as a bucket' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
end;
$$;

-- Parcels to keep, and what a signed-in account may reach.
do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  keeper constant uuid := 'c1000000-0000-4000-8000-000000000001';
  sharer constant uuid := 'c1000000-0000-4000-8000-000000000002';
  answer jsonb;
  target_package uuid;
  link_id text;
begin
  -- Transfer: one link, with a refresh already queued.
  answer := public.create_one_off_parcel('ONEOFFKEEP0001', 'unknown', null, null, key_a);
  target_package := (answer#>>'{package,id}')::uuid;
  perform set_config('parcel_test.transfer_link', answer#>>'{link,id}', true);
  perform set_config('parcel_test.transfer_package', target_package::text, true);
  insert into public.sync_jobs (package_id, kind, dedupe_key) values (target_package, 'package', 'package:' || target_package);

  -- Copy: two lookups share the parcel, which has a postcode and routing state.
  answer := public.create_one_off_parcel('ONEOFFKEEP0002', 'dpd', null, '8000', key_a);
  target_package := (answer#>>'{package,id}')::uuid;
  perform set_config('parcel_test.copy_link', answer#>>'{link,id}', true);
  perform set_config('parcel_test.copy_source', target_package::text, true);
  answer := public.create_one_off_parcel('ONEOFFKEEP0002', 'dpd', null, '8000', key_b);
  perform set_config('parcel_test.copy_other_link', answer#>>'{link,id}', true);
  update public.packages set current_stage = 'in_transit', sync_status = 'ok', last_synced_at = now(),
    last_status_text = 'Synthetic scan', carrier_data = '{"routing":{"confirmed_postcode":"8000"},"sender_name":"Example sender"}'
  where id = target_package;
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
  values (target_package, 'test:scan', 'in_transit', 'Synthetic scan', now() - interval '1 hour');

  -- Already: the account has the number.
  insert into public.packages (id, user_id, tracking_number, carrier)
  values ('c2000000-0000-4000-8000-000000000003', keeper, 'ONEOFFKEEP0003', 'unknown');
  answer := public.create_one_off_parcel('ONEOFFKEEP0003', 'unknown', null, null, key_a);
  perform set_config('parcel_test.already_link', answer#>>'{link,id}', true);
  perform set_config('parcel_test.already_source', answer#>>'{package,id}', true);

  -- Quota: the third account's box is full.
  insert into public.packages (user_id, tracking_number, carrier)
  select 'c1000000-0000-4000-8000-000000000003', 'ONEOFFFULL' || to_char(n, 'FM0000'), 'unknown'
  from generate_series(1, 50) as n;
  answer := public.create_one_off_parcel('ONEOFFKEEP0004', 'unknown', null, null, key_a);
  perform set_config('parcel_test.quota_link', answer#>>'{link,id}', true);

  -- Viewer: a parcel shared from an account, with and without its number shown.
  insert into public.packages (id, user_id, tracking_number, label, carrier, dpd_postcode, current_stage, carrier_data)
  values ('c2000000-0000-4000-8000-000000000005', sharer, 'ONEOFFKEEP0005', 'Private name', 'gls-ch', '8000', 'in_transit',
    '{"routing":{"confirmed_postcode":"8000"},"receiver_name":"Example recipient"}');
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
  values ('c2000000-0000-4000-8000-000000000005', 'test:scan', 'in_transit', 'Synthetic scan', now() - interval '1 hour');
  insert into public.parcel_links (package_id, created_by, show_number)
  values ('c2000000-0000-4000-8000-000000000005', sharer, true) returning id into link_id;
  perform set_config('parcel_test.shown_link', link_id, true);
  -- An account shares a parcel through one live link: the hidden one is another parcel's.
  insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
  values ('c2000000-0000-4000-8000-000000000007', sharer, 'ONEOFFKEEP0007', 'unknown', 'in_transit');
  insert into public.parcel_links (package_id, created_by)
  values ('c2000000-0000-4000-8000-000000000007', sharer) returning id into link_id;
  perform set_config('parcel_test.hidden_link', link_id, true);
end;
$$;

set local role authenticated;

do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  transfer_link constant text := current_setting('parcel_test.transfer_link');
  transfer_package constant uuid := current_setting('parcel_test.transfer_package');
  answer jsonb;
  attempt record;
begin
  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

  -- A one-off parcel is nobody's: no account sees it or its history.
  if exists (select 1 from public.packages where one_off)
      or exists (select 1 from public.packages where id = transfer_package)
      or exists (select 1 from public.tracking_events where package_id = transfer_package) then
    raise exception 'A signed-in account can read a one-off parcel';
  end if;
  begin
    perform count(*) from public.parcel_links;
    raise exception 'A signed-in account can read parcel links' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.public_parcel(transfer_link);
    raise exception 'A signed-in account can call the server''s link reader' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;

  -- A wrong key, no key, an unknown link and a link that hides its number answer alike.
  for attempt in
    select * from (values
      (transfer_link, key_b),
      (transfer_link, null),
      ('unknownLink2', key_a),
      (current_setting('parcel_test.hidden_link'), null)
    ) as attempts(link, key)
  loop
    begin
      perform public.claim_parcel_link(attempt.link, attempt.key);
      raise exception 'A parcel was kept without the right to it' using errcode = 'P0001';
    exception when sqlstate 'P0002' then
      if sqlerrm <> 'Parcel unavailable' then raise; end if;
    end;
  end loop;
  begin
    perform public.claim_parcel_link(transfer_link, key_a, repeat('n', 81));
    raise exception 'An overlong name was accepted' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;

  answer := public.claim_parcel_link(transfer_link, key_a, '  Sneakers ');
  if answer <> jsonb_build_object('outcome', 'kept', 'package_id', transfer_package)
      or not exists (select 1 from public.packages where id = transfer_package and label = 'Sneakers' and not one_off) then
    raise exception 'The only link''s parcel was not transferred: %', answer;
  end if;
  -- A repeated request after a lost answer finds the parcel kept.
  answer := public.claim_parcel_link(transfer_link, key_a);
  if answer <> jsonb_build_object('outcome', 'already', 'package_id', transfer_package) then
    raise exception 'Keeping twice did not answer already: %', answer;
  end if;

  answer := public.claim_parcel_link(current_setting('parcel_test.copy_link'), key_a, 'Copy');
  if answer->>'outcome' <> 'kept' or answer->>'package_id' = current_setting('parcel_test.copy_source')
      or not exists (
        select 1 from public.packages
        where id = (answer->>'package_id')::uuid and tracking_number = 'ONEOFFKEEP0002' and label = 'Copy'
          and carrier = 'dpd' and dpd_postcode = '8000' and current_stage = 'in_transit' and sync_status = 'ok'
          and last_status_text = 'Synthetic scan' and carrier_data->>'sender_name' = 'Example sender' and not one_off
      )
      or (select count(*) from public.tracking_events where package_id = (answer->>'package_id')::uuid) <> 2 then
    raise exception 'A shared one-off parcel was not copied: %', answer;
  end if;
  perform set_config('parcel_test.copy_package', answer->>'package_id', true);

  answer := public.claim_parcel_link(current_setting('parcel_test.already_link'), key_a);
  if answer <> '{"outcome":"already","package_id":"c2000000-0000-4000-8000-000000000003"}' then
    raise exception 'A number already in the box was kept again: %', answer;
  end if;

  -- A viewer's copy has the number and the visible history, nothing the sharer entered.
  answer := public.claim_parcel_link(current_setting('parcel_test.shown_link'), null, 'Shared with me');
  if answer->>'outcome' <> 'kept' or not exists (
        select 1 from public.packages
        where id = (answer->>'package_id')::uuid and tracking_number = 'ONEOFFKEEP0005' and label = 'Shared with me'
          and carrier = 'gls-ch' and dpd_postcode is null and tracking_url is null and carrier_data = '{}'::jsonb
          and current_stage = 'in_transit' and sync_status = 'pending' and last_synced_at is null
      )
      or (select count(*) from public.tracking_events where package_id = (answer->>'package_id')::uuid) <> 2 then
    raise exception 'A viewer''s copy is wrong: %', answer;
  end if;

  -- An anonymous session, or none, keeps nothing.
  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
  begin
    perform public.claim_parcel_link(current_setting('parcel_test.quota_link'), key_a);
    raise exception 'An anonymous session kept a parcel' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.claim_parcel_link(current_setting('parcel_test.quota_link'), key_a);
    raise exception 'A parcel was kept without a session' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;

  -- A transferred link lost its key: the next account cannot take the parcel.
  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
  begin
    perform public.claim_parcel_link(transfer_link, key_a);
    raise exception 'A second account kept a transferred parcel' using errcode = 'P0001';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.packages where id = transfer_package) then
    raise exception 'A second account can read a transferred parcel';
  end if;

  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
  answer := public.claim_parcel_link(current_setting('parcel_test.quota_link'), key_a);
  if answer <> '{"outcome":"quota","package_id":null}' then
    raise exception 'A full box kept another parcel: %', answer;
  end if;
end;
$$;

set local role service_role;

do $$
declare
  keeper constant uuid := 'c1000000-0000-4000-8000-000000000001';
  transfer_package constant uuid := current_setting('parcel_test.transfer_package');
  copy_package constant uuid := current_setting('parcel_test.copy_package');
  copy_source constant uuid := current_setting('parcel_test.copy_source');
begin
  if not exists (
        select 1 from public.packages where id = transfer_package and user_id = keeper and not one_off
      )
      or not exists (
        select 1 from public.parcel_links
        where id = current_setting('parcel_test.transfer_link') and package_id = transfer_package
          and created_by = keeper and owner_key_hash is null and not show_number
      )
      or exists (select 1 from public.sync_jobs where package_id = transfer_package and user_id is distinct from keeper) then
    raise exception 'A transferred parcel, its link or its queued refresh did not move to the account';
  end if;
  if not exists (
        select 1 from public.parcel_links
        where id = current_setting('parcel_test.copy_link') and package_id = copy_package
          and created_by = keeper and owner_key_hash is null
      )
      or not exists (
        select 1 from public.parcel_links
        where id = current_setting('parcel_test.copy_other_link') and package_id = copy_source
          and created_by is null and owner_key_hash = repeat('b', 64)
      )
      or not exists (select 1 from public.packages where id = copy_source and one_off and user_id is null) then
    raise exception 'A copy disturbed the other lookup of the parcel';
  end if;
  if exists (select 1 from public.parcel_links where id = current_setting('parcel_test.already_link'))
      or exists (select 1 from public.packages where id = current_setting('parcel_test.already_source')::uuid) then
    raise exception 'A lookup of a number already in the box was not forgotten';
  end if;
  if (select count(*) from public.parcel_links where id in (
        current_setting('parcel_test.quota_link'), current_setting('parcel_test.shown_link'), current_setting('parcel_test.hidden_link')
      )) <> 3
      or not exists (
        select 1 from public.parcel_links
        where id = current_setting('parcel_test.shown_link') and package_id = 'c2000000-0000-4000-8000-000000000005'
      ) then
    raise exception 'A refused or a viewer''s keep changed a link';
  end if;

  -- A parcel without an owner tells nobody: the push queues go through the account.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, subscribed_at)
  values (keeper, 'https://fcm.googleapis.com/fcm/send/parcel-links', 'test-key', 'test-auth', now() - interval '1 hour');
  insert into public.native_push_devices (user_id, token, environment, subscribed_at)
  values (keeper, repeat('97', 32), 'development', now() - interval '1 hour');
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at)
  values (copy_source, 'test:new', 'out_for_delivery', 'Synthetic scan', now()),
    (copy_package, 'test:new', 'out_for_delivery', 'Synthetic scan', now());
  if not exists (select 1 from public.pending_push_notifications where package_id = copy_package)
      or not exists (select 1 from public.pending_native_push_notifications where package_id = copy_package)
      or exists (select 1 from public.pending_push_notifications where package_id = copy_source)
      or exists (select 1 from public.pending_native_push_notifications where package_id = copy_source)
      or exists (select 1 from public.pending_live_activity_events where package_id = copy_source) then
    raise exception 'A one-off parcel reached a push queue, or a kept one did not';
  end if;

  -- A kept parcel's link follows it when its two legs are merged.
  insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
  values ('c2000000-0000-4000-8000-000000000006', keeper, 'ONEOFFKEEP0006', 'swiss-post', 'in_transit');
  perform public.link_package_tracking(transfer_package, 'c2000000-0000-4000-8000-000000000006');
  if not exists (
    select 1 from public.parcel_links
    where id = current_setting('parcel_test.transfer_link') and package_id = 'c2000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'A link did not follow its merged parcel';
  end if;
end;
$$;
rollback;
