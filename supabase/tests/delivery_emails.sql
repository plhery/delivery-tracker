\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email, is_anonymous) values
 ('e1000000-0000-4000-8000-000000000001', 'alex@example.com', false),
 ('e1000000-0000-4000-8000-000000000002', 'second@example.com', false),
 ('e1000000-0000-4000-8000-000000000003', 'never-chose@example.com', false),
 ('e1000000-0000-4000-8000-000000000004', null, true);

-- One transaction has one clock, so the tests place every row in the past by
-- hand: "ago" is how long before now() something happened.

-- A parcel of an account: when it joined, and the stage it shows now.
create function pg_temp.parcel(p_user uuid, p_number text, p_joined_ago interval, p_stage text default 'delivered')
returns uuid
language plpgsql
as $$
declare
  parcel_id uuid;
begin
  insert into public.packages (user_id, tracking_number, carrier, current_stage, created_at)
  values (p_user, p_number, 'unknown', p_stage, now() - p_joined_ago)
  returning id into parcel_id;
  update public.packages set owned_since = now() - p_joined_ago where id = parcel_id;
  update public.tracking_events set created_at = now() - p_joined_ago where package_id = parcel_id;
  return parcel_id;
end;
$$;

-- A scan: when the carrier says it happened, when a check stored it, and what
-- the carrier gave as its time. Left out, that is a clock time.
create function pg_temp.scan(
  p_parcel uuid,
  p_stage text,
  p_occurred_ago interval,
  p_stored_ago interval,
  p_raw jsonb default null
)
returns uuid
language sql
as $$
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at, created_at, raw_data)
  values (
    p_parcel, 'test:' || gen_random_uuid(), p_stage, 'Test scan', now() - p_occurred_ago, now() - p_stored_ago,
    coalesce(p_raw, jsonb_build_object('time', to_char((now() - p_occurred_ago) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  )
  returning id;
$$;

-- A check of the parcel that answered, with the stage it settled on.
create function pg_temp.checked(p_parcel uuid, p_ago interval, p_stage text default 'in_transit', p_outcome text default 'updated')
returns void
language sql
as $$
  insert into public.tracking_sync_attempts (
    package_id, trigger, configured_carrier, outcome, current_step, selected_stage, started_at, completed_at
  ) values (
    p_parcel, 'scheduled', 'unknown', p_outcome, 'complete', p_stage, now() - p_ago, now() - p_ago + interval '2 seconds'
  );
$$;

-- The account's email, on since a while or off.
create function pg_temp.email(p_user uuid, p_on boolean, p_on_since_ago interval default interval '10 days')
returns void
language sql
as $$
  insert into public.notification_preferences (user_id, timezone, email_on_delivery, email_enabled_at)
  values (p_user, 'America/New_York', p_on, now() - p_on_since_ago)
  on conflict (user_id) do update set
    email_on_delivery = excluded.email_on_delivery, email_enabled_at = excluded.email_enabled_at;
$$;

-- The parcels a claim says to email, in its order.
create function pg_temp.sends(p_claim jsonb)
returns uuid[]
language sql
as $$
  select coalesce(array_agg((entry->>'package_id')::uuid order by position), '{}')
  from jsonb_array_elements(p_claim->'send') with ordinality as sent(entry, position);
$$;

-- Starts a case from nothing: no claim, and no parcel in the test accounts.
create function pg_temp.fresh()
returns void
language sql
as $$
  delete from public.delivery_emails;
  delete from public.packages where user_id::text like 'e1000000-%';
  delete from public.notification_preferences where user_id::text like 'e1000000-%';
  select pg_temp.email('e1000000-0000-4000-8000-000000000001', true);
$$;

-- The account's choice: kept by a save that does not name it, and started
-- anew each time it is switched on.
set local role authenticated;
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  saved public.notification_preferences;
begin
  perform set_config('request.jwt.claim.sub', alex::text, true);
  saved := public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich');
  if saved.email_on_delivery is not null or saved.email_enabled_at is not null then
    raise exception 'A first save chose the email: %', saved;
  end if;
  saved := public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich', true);
  if saved.email_on_delivery is not true or saved.email_enabled_at <> now() then
    raise exception 'Switching the email on did not start it now: %', saved;
  end if;

  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true);
  begin
    perform public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich', true);
    raise exception 'An anonymous user switched the email on' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_delivery_email(alex, false);
    raise exception 'An account switched an email by account id' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_delivery_emails(20, 20, 80);
    raise exception 'An account claimed delivery emails' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.delivery_emails;
    raise exception 'An account read the delivery emails' using errcode = 'P0001';
  exception when insufficient_privilege then null; end;
end;
$$;

set local role service_role;
update public.notification_preferences set email_enabled_at = now() - interval '3 days'
where user_id = 'e1000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  saved public.notification_preferences;
begin
  perform set_config('request.jwt.claim.sub', alex::text, true);
  -- Saving it on again, or leaving it out, does not restart it.
  saved := public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich', true);
  if saved.email_on_delivery is not true or saved.email_enabled_at <> now() - interval '3 days' then
    raise exception 'Saving the email on again restarted it: %', saved;
  end if;
  saved := public.set_owned_notification_preferences(array['delivered', 'customs'], '22:00', '07:00', 'Europe/Paris', null);
  if saved.email_on_delivery is not true or saved.email_enabled_at <> now() - interval '3 days'
      or saved.timezone <> 'Europe/Paris' or cardinality(saved.enabled_stages) <> 2 then
    raise exception 'A save without the email changed it: %', saved;
  end if;
  saved := public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich', false);
  if saved.email_on_delivery is not false or saved.email_enabled_at <> now() - interval '3 days' then
    raise exception 'The email was not switched off: %', saved;
  end if;
  saved := public.set_owned_notification_preferences(array['delivered'], null, null, 'Europe/Zurich', true);
  if saved.email_on_delivery is not true or saved.email_enabled_at <> now() then
    raise exception 'Switching the email back on did not start it anew: %', saved;
  end if;
end;
$$;

-- The link in an email switches it without a sign-in: the server does, by account.
set local role service_role;
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  never constant uuid := 'e1000000-0000-4000-8000-000000000003';
  stored public.notification_preferences;
begin
  if public.set_delivery_email(alex, false) is not false then
    raise exception 'The link did not switch the email off';
  end if;
  update public.notification_preferences set email_enabled_at = now() - interval '3 days' where user_id = alex;
  if public.set_delivery_email(alex, false) is not false then
    raise exception 'The link did not keep the email off';
  end if;
  if public.set_delivery_email(alex, true) is not true then
    raise exception 'The link did not switch the email back on';
  end if;
  select * into stored from public.notification_preferences where user_id = alex;
  if stored.email_enabled_at <> now() or stored.enabled_stages <> array['delivered'] then
    raise exception 'Switching back on from the link did not start anew, or changed the rest: %', stored;
  end if;
  update public.notification_preferences set email_enabled_at = now() - interval '3 days' where user_id = alex;
  if public.set_delivery_email(alex, true) is not true then
    raise exception 'The link did not keep the email on';
  end if;
  if (select email_enabled_at from public.notification_preferences where user_id = alex) <> now() - interval '3 days' then
    raise exception 'Switching on an email that is on restarted it';
  end if;

  -- An account that never saved preferences gets its row, with the defaults.
  if public.set_delivery_email(never, false) is not false then
    raise exception 'The link did not switch off an email that was never chosen';
  end if;
  select * into stored from public.notification_preferences where user_id = never;
  if stored.email_on_delivery is not false or stored.email_enabled_at is not null
      or cardinality(stored.enabled_stages) <> 10 or stored.timezone <> 'Europe/Zurich'
      or stored.quiet_hours_start is not null then
    raise exception 'The row the link made is not the default one: %', stored;
  end if;

  if public.set_delivery_email('e1000000-0000-4000-8000-0000000000ff', false) is not null
      or public.set_delivery_email('e1000000-0000-4000-8000-000000000004', true) is not null then
    raise exception 'An unknown or anonymous account was answered';
  end if;
  if exists (select 1 from public.notification_preferences where user_id = 'e1000000-0000-4000-8000-000000000004') then
    raise exception 'An anonymous account got an email choice';
  end if;
  begin
    perform public.set_delivery_email(alex, null);
    raise exception 'A switch to nothing was accepted' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
end;
$$;

-- When the parcel joined its account is recorded as it is added.
set local role authenticated;
do $$
declare
  added uuid;
begin
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  select id into added from public.create_owned_package('EMAILTEST0001', 'Joined now', 'unknown', null, null);
  if (select owned_since from public.packages where id = added) is distinct from now() then
    raise exception 'A parcel added to an account does not say when it joined';
  end if;
  if not public.set_owned_package_email_muted(added, true) then
    raise exception 'An owner could not leave a parcel out of the email';
  end if;
  if not (select email_muted from public.packages where id = added) then
    raise exception 'Leaving a parcel out of the email was not stored';
  end if;
  if not public.set_owned_package_email_muted(added, false) then
    raise exception 'An owner could not put a parcel back in the email';
  end if;
  if (select email_muted or notifications_muted from public.packages where id = added) then
    raise exception 'Putting a parcel back in the email was not stored, or changed its notifications';
  end if;
  begin
    perform public.set_owned_package_email_muted(added, null);
    raise exception 'A parcel was left out of the email by nothing' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
  if public.set_owned_package_email_muted(added, true) then
    raise exception 'Another account left a parcel out of the email';
  end if;
end;
$$;

set local role service_role;

-- What is announced: a delivery that came after the parcel joined the account.
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  parcel uuid;
  delivered uuid;
  claim jsonb;
  entry jsonb;
  ledger public.delivery_emails;
begin
  -- Delivered an hour after it was added, with a clock time.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1001', '5 hours');
  perform pg_temp.scan(parcel, 'in_transit', '6 hours', '4 hours 59 minutes');
  delivered := pg_temp.scan(parcel, 'delivered', '4 hours', '3 hours 50 minutes');
  claim := public.claim_delivery_emails(20, 20, 80);
  entry := claim#>'{send,0}';
  select * into ledger from public.delivery_emails where package_id = parcel;
  if pg_temp.sends(claim) <> array[parcel] or claim->'account_cap' <> '0' or claim->'service_cap' <> '0'
      or entry->>'id' <> ledger.id::text or entry->>'user_id' <> alex::text or entry->>'event_id' <> delivered::text
      or entry->>'timezone' <> 'America/New_York' or entry->>'delivered_time' <> 'timed'
      or (select count(*) from jsonb_object_keys(entry)) <> 6
      or ledger.status <> 'claimed' or ledger.attempts <> 1 or ledger.user_id <> alex or ledger.event_id <> delivered
      or ledger.claimed_at <> now() or ledger.sent_at is not null or ledger.reason is not null then
    raise exception 'A parcel delivered an hour after it was added was not claimed: % %', claim, ledger;
  end if;

  -- Added when it was already delivered: the carrier's time says so.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1002', '2 hours');
  perform pg_temp.checked(parcel, '1 hour 59 minutes', 'delivered');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '1 hour 59 minutes');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A parcel added already delivered was claimed: %', claim;
  end if;

  -- Added when it was already delivered, the scan carrying only today's date:
  -- the first answer cannot tell, and it is the only one.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1003', '2 hours');
  perform pg_temp.checked(parcel, '1 hour 59 minutes', 'delivered');
  perform pg_temp.scan(parcel, 'delivered', '10 hours', '1 hour 59 minutes', '{"time":"2026-10-03"}');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A parcel added already delivered, on a day without a time, was claimed: %', claim;
  end if;
  -- Nor does a later check that says otherwise make it news.
  perform pg_temp.checked(parcel, '30 minutes', 'in_transit');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A check after the delivery was stored made it news';
  end if;

  -- Delivered the next day, the scan carrying only that day: an earlier check
  -- answered without a delivery, so it is news.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1004', '30 hours');
  perform pg_temp.checked(parcel, '29 hours 59 minutes', 'in_transit');
  perform pg_temp.scan(parcel, 'in_transit', '31 hours', '29 hours 59 minutes');
  perform pg_temp.checked(parcel, '2 hours', 'delivered');
  delivered := pg_temp.scan(parcel, 'delivered', '6 hours', '2 hours', '{"time":"2026-10-03"}');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[parcel] or claim#>>'{send,0,delivered_time}' <> 'date'
      or claim#>>'{send,0,event_id}' <> delivered::text then
    raise exception 'A parcel delivered the next day, on a day without a time, was not claimed: %', claim;
  end if;

  -- The day can be written the other way round, and counts back to the day the parcel joined.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1005', '8 hours');
  perform pg_temp.checked(parcel, '7 hours', 'out_for_delivery');
  perform pg_temp.scan(parcel, 'delivered', '20 hours', '1 hour', '{"time":"03.10.2026"}');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[parcel] or claim#>>'{send,0,delivered_time}' <> 'date' then
    raise exception 'A delivery dated the day the parcel joined was not claimed: %', claim;
  end if;

  -- A day from before the parcel joined is history, whenever it is stored.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1006', '8 hours');
  perform pg_temp.checked(parcel, '7 hours', 'in_transit');
  perform pg_temp.scan(parcel, 'delivered', '2 days 8 hours', '1 hour', '{"time":"2026-10-01"}');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A delivery dated before the parcel joined was claimed';
  end if;

  -- A delivery the app noticed, without a time from the carrier.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1007', '30 hours');
  perform pg_temp.checked(parcel, '20 hours', 'in_transit');
  perform pg_temp.checked(parcel, '1 hour', 'delivered');
  perform pg_temp.scan(parcel, 'delivered', '1 hour', '1 hour', '{"time":"2026-10-03T10:00:00Z","observed_without_provider_timestamp":true}');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[parcel] or claim#>>'{send,0,delivered_time}' <> 'none' then
    raise exception 'A delivery noticed after an earlier check was not claimed: %', claim;
  end if;

  -- The same, when no check since the parcel joined answered without a delivery:
  -- none at all, one that found nothing, one that failed, one from before it joined.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1008', '30 hours');
  perform pg_temp.checked(parcel, '40 hours', 'in_transit');
  perform pg_temp.checked(parcel, '20 hours', null, 'waiting');
  perform pg_temp.checked(parcel, '10 hours', null, 'error');
  perform pg_temp.checked(parcel, '1 hour', 'delivered');
  perform pg_temp.scan(parcel, 'delivered', '1 hour', '1 hour', '{"observed_without_provider_timestamp":true}');
  perform pg_temp.scan(parcel, 'delivered', '1 hour', '1 hour', '{"time":"not a time"}');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A delivery without a time was claimed without an earlier answer';
  end if;

  -- A parcel its first check found delivered is not news when another scan
  -- without a time says so again: no check answered without a delivery.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1018', '30 hours');
  perform pg_temp.checked(parcel, '29 hours', 'delivered');
  perform pg_temp.scan(parcel, 'delivered', '40 hours', '29 hours', '{"time":"2026-10-02"}');
  perform pg_temp.checked(parcel, '1 hour', 'delivered');
  delivered := pg_temp.scan(parcel, 'delivered', '1 hour', '1 hour', '{"observed_without_provider_timestamp":true}');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A parcel found delivered at its first check was claimed later: %', claim;
  end if;
  update public.tracking_sync_attempts set selected_stage = 'in_transit'
  where package_id = parcel and started_at < now() - interval '2 hours';
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'The same parcel, first found on its way, was not claimed';
  end if;

  -- Stored before the email was switched on: switching it on announces nothing that is there.
  perform pg_temp.fresh();
  perform pg_temp.email(alex, true, '1 hour');
  parcel := pg_temp.parcel(alex, 'EMAILTEST1009', '5 hours');
  perform pg_temp.scan(parcel, 'delivered', '3 hours', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A scan from before the email was switched on was claimed: %', claim;
  end if;
  perform pg_temp.email(alex, true, '10 days');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'The same scan, stored while the email was on, was not claimed';
  end if;

  -- Stored more than a day ago: stale news is never sent.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1010', '3 days');
  delivered := pg_temp.scan(parcel, 'delivered', '26 hours', '24 hours 1 minute');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A scan stored more than a day ago was claimed: %', claim;
  end if;
  update public.tracking_events set created_at = now() - interval '23 hours 59 minutes' where id = delivered;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'A scan stored within the day was not claimed';
  end if;

  -- The parcel's newest scan, give or take an hour.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1012', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  perform pg_temp.scan(parcel, 'in_transit', '3 hours', '2 hours');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A delivery older than the parcel''s newest scan was claimed';
  end if;
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1013', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  perform pg_temp.scan(parcel, 'in_transit', '4 hours 10 minutes', '2 hours');
  -- A scan dated ahead is a forecast or a clock read wrong: it is not the newest.
  perform pg_temp.scan(parcel, 'in_transit', '-3 hours', '2 hours');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'A delivery within an hour of the parcel''s newest scan was not claimed';
  end if;

  -- Two delivered scans are one delivery: the newest is told.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1014', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  delivered := pg_temp.scan(parcel, 'delivered', '4 hours 30 minutes', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[parcel] or claim#>>'{send,0,event_id}' <> delivered::text
      or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'Two delivered scans were not told as one, by the newest: %', claim;
  end if;

  -- Nothing for a parcel left out of the email, put away or not delivered, nor
  -- for an account whose email is off or was never chosen. Each alone holds it back.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1015', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  update public.packages set email_muted = true where id = parcel;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A parcel left out of the email was claimed';
  end if;
  update public.packages set email_muted = false, archived_at = now() where id = parcel;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'An archived parcel was claimed';
  end if;
  update public.packages set archived_at = null, current_stage = 'exception' where id = parcel;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A parcel that does not show as delivered was claimed';
  end if;
  update public.packages set current_stage = 'delivered' where id = parcel;
  perform pg_temp.email(alex, false);
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'An account whose email is off was claimed for';
  end if;
  update public.notification_preferences set email_on_delivery = null where user_id = alex;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'An account that never chose the email was claimed for: %', claim;
  end if;
  perform pg_temp.email(alex, true);
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'The parcel was not claimed once nothing held it back';
  end if;

  -- A row the app wrote itself is not a carrier's scan.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1016', '9 hours');
  update public.tracking_events
  set stage = 'delivered', provider_event_id = 'app:delivered', occurred_at = now() - interval '5 hours',
    created_at = now() - interval '2 hours', raw_data = '{"time":"2026-10-03T08:00:00Z"}'
  where package_id = parcel;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A row of the app was claimed: %', claim;
  end if;
  update public.tracking_events set provider_event_id = 'test:delivered' where package_id = parcel;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'The same row, as a carrier''s scan, was not claimed';
  end if;

  -- A scan stored before the parcel joined is history, even when a clock read
  -- ahead dates it later.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST1017', '1 hour');
  delivered := pg_temp.scan(parcel, 'delivered', '30 minutes', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A scan stored before the parcel joined was claimed: %', claim;
  end if;
  update public.tracking_events set created_at = now() - interval '20 minutes' where id = delivered;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> array[parcel] then
    raise exception 'The same scan, stored after the parcel joined, was not claimed';
  end if;
end;
$$;

-- Once per parcel: a claim is not made twice, a failed send is claimed again
-- up to three times while it is fresh, and anything else is final.
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  parcel uuid;
  delivered uuid;
  claim jsonb;
  ledger public.delivery_emails;
  first_id uuid;
begin
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST2001', '9 hours');
  delivered := pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  first_id := (claim#>>'{send,0,id}')::uuid;
  if pg_temp.sends(claim) <> array[parcel] or pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A claimed parcel was claimed again';
  end if;
  if not public.finish_delivery_email(first_id, 'sent') then
    raise exception 'A claim did not end';
  end if;
  if public.finish_delivery_email(first_id, 'failed', 'smtp') then
    raise exception 'A claim ended twice';
  end if;
  select * into ledger from public.delivery_emails where id = first_id;
  if ledger.status <> 'sent' or ledger.sent_at <> now() or ledger.reason is not null or ledger.attempts <> 1 then
    raise exception 'A sent email was not recorded: %', ledger;
  end if;
  -- A newer delivered scan of a parcel that was told is not news.
  perform pg_temp.scan(parcel, 'delivered', '1 hour', '30 minutes');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A parcel was emailed twice';
  end if;

  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST2002', '9 hours');
  delivered := pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  for attempt in 1..3 loop
    claim := public.claim_delivery_emails(20, 20, 80);
    select * into ledger from public.delivery_emails where package_id = parcel;
    if pg_temp.sends(claim) <> array[parcel] or claim#>>'{send,0,id}' <> ledger.id::text
        or ledger.status <> 'claimed' or ledger.attempts <> attempt or ledger.reason is not null then
      raise exception 'Attempt % of a failed email was not claimed: % %', attempt, claim, ledger;
    end if;
    if not public.finish_delivery_email(ledger.id, 'failed', 'smtp') then
      raise exception 'A failed send was not recorded';
    end if;
    -- The next attempt waits: a quarter of an hour after the first, an hour after the second.
    update public.delivery_emails
    set claimed_at = now() - case attempt when 1 then interval '14 minutes' else interval '59 minutes' end
    where id = ledger.id;
    if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
      raise exception 'Attempt % was followed by the next at once', attempt;
    end if;
    update public.delivery_emails
    set claimed_at = now() - case attempt when 1 then interval '15 minutes' else interval '1 hour' end
    where id = ledger.id;
  end loop;
  claim := public.claim_delivery_emails(20, 20, 80);
  select * into ledger from public.delivery_emails where package_id = parcel;
  if pg_temp.sends(claim) <> '{}'
      or ledger.status <> 'failed' or ledger.reason <> 'smtp' or ledger.attempts <> 3 or ledger.sent_at is not null
      or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'A fourth attempt was made: %', ledger;
  end if;

  -- A failed send is not tried again once its scan is a day old.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST2003', '3 days');
  delivered := pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  perform public.finish_delivery_email((claim#>>'{send,0,id}')::uuid, 'failed', 'smtp');
  update public.delivery_emails set claimed_at = now() - interval '2 hours';
  update public.tracking_events set created_at = now() - interval '25 hours' where id = delivered;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A stale failed email was tried again';
  end if;

  -- A skipped email is final, and the reason is a short code.
  perform pg_temp.fresh();
  parcel := pg_temp.parcel(alex, 'EMAILTEST2004', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '2 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  first_id := (claim#>>'{send,0,id}')::uuid;
  begin
    perform public.finish_delivery_email(first_id, 'claimed');
    raise exception 'A claim ended as claimed' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.finish_delivery_email(first_id, 'skipped', 'alex@example.com');
    raise exception 'A reason that is not a code was stored' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  if not public.finish_delivery_email(first_id, 'skipped', 'no_address') then
    raise exception 'A claim could not end as skipped';
  end if;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}'
      or not exists (select 1 from public.delivery_emails where id = first_id and status = 'skipped' and reason = 'no_address') then
    raise exception 'A skipped email was not final: %', claim;
  end if;
  if public.finish_delivery_email('e1000000-0000-4000-8000-0000000000ff', 'sent') then
    raise exception 'An unknown claim ended';
  end if;
end;
$$;

-- The allowances: an account's and everyone's emails in 24 hours. What is
-- beyond one is recorded as skipped, not sent later.
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  other_account constant uuid := 'e1000000-0000-4000-8000-000000000002';
  oldest uuid;
  middle uuid;
  newest uuid;
  other uuid;
  claim jsonb;
begin
  perform pg_temp.fresh();
  oldest := pg_temp.parcel(alex, 'EMAILTEST3001', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '3 hours');
  middle := pg_temp.parcel(alex, 'EMAILTEST3002', '9 hours');
  perform pg_temp.scan(middle, 'delivered', '5 hours', '2 hours');
  newest := pg_temp.parcel(alex, 'EMAILTEST3003', '9 hours');
  perform pg_temp.scan(newest, 'delivered', '5 hours', '1 hour');
  claim := public.claim_delivery_emails(20, 2, 80);
  if pg_temp.sends(claim) <> array[oldest, middle] or claim->'account_cap' <> '1' or claim->'service_cap' <> '0'
      or not exists (
        select 1 from public.delivery_emails
        where package_id = newest and status = 'skipped' and reason = 'account_cap' and attempts = 0 and sent_at is null
      ) then
    raise exception 'An account''s allowance was not kept: %', claim;
  end if;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or claim->'account_cap' <> '0' then
    raise exception 'An email skipped for the allowance was sent later: %', claim;
  end if;

  -- What the account was sent in the last 24 hours counts, what it was sent before does not.
  perform pg_temp.fresh();
  insert into public.delivery_emails (user_id, status, attempts, claimed_at, sent_at) values
    (alex, 'sent', 1, now() - interval '3 hours', now() - interval '3 hours'),
    (alex, 'sent', 1, now() - interval '25 hours', now() - interval '25 hours'),
    (alex, 'failed', 1, now() - interval '2 hours', null),
    (alex, 'skipped', 0, now() - interval '2 hours', null);
  oldest := pg_temp.parcel(alex, 'EMAILTEST3004', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '3 hours');
  newest := pg_temp.parcel(alex, 'EMAILTEST3005', '9 hours');
  perform pg_temp.scan(newest, 'delivered', '5 hours', '1 hour');
  claim := public.claim_delivery_emails(20, 2, 80);
  if pg_temp.sends(claim) <> array[oldest] or claim->'account_cap' <> '1' then
    raise exception 'Emails of the last 24 hours were not counted against an account: %', claim;
  end if;

  -- Everyone's allowance, the oldest scan first. One account at its own
  -- allowance does not use up the others' share.
  perform pg_temp.fresh();
  perform pg_temp.email(other_account, true);
  oldest := pg_temp.parcel(alex, 'EMAILTEST3006', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '4 hours');
  middle := pg_temp.parcel(alex, 'EMAILTEST3007', '9 hours');
  perform pg_temp.scan(middle, 'delivered', '5 hours', '3 hours');
  other := pg_temp.parcel(other_account, 'EMAILTEST3008', '9 hours');
  perform pg_temp.scan(other, 'delivered', '5 hours', '2 hours');
  newest := pg_temp.parcel(other_account, 'EMAILTEST3009', '9 hours');
  perform pg_temp.scan(newest, 'delivered', '5 hours', '1 hour');
  claim := public.claim_delivery_emails(20, 1, 2);
  if pg_temp.sends(claim) <> array[oldest, other] or claim->'account_cap' <> '2' or claim->'service_cap' <> '0' then
    raise exception 'Accounts at their allowance used up everyone''s: %', claim;
  end if;
  perform pg_temp.fresh();
  perform pg_temp.email(other_account, true);
  oldest := pg_temp.parcel(alex, 'EMAILTEST3010', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '3 hours');
  other := pg_temp.parcel(other_account, 'EMAILTEST3011', '9 hours');
  perform pg_temp.scan(other, 'delivered', '5 hours', '2 hours');
  insert into public.delivery_emails (user_id, status, attempts, claimed_at) values
    ('e1000000-0000-4000-8000-000000000003', 'claimed', 1, now() - interval '1 minute');
  claim := public.claim_delivery_emails(20, 20, 2);
  if pg_temp.sends(claim) <> array[oldest] or claim->'service_cap' <> '1' or claim->'account_cap' <> '0'
      or not exists (
        select 1 from public.delivery_emails where package_id = other and status = 'skipped' and reason = 'service_cap'
      ) then
    raise exception 'Everyone''s allowance was not kept: %', claim;
  end if;

  -- A failed email is counted again when it is tried again.
  perform pg_temp.fresh();
  oldest := pg_temp.parcel(alex, 'EMAILTEST3012', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '3 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  perform public.finish_delivery_email((claim#>>'{send,0,id}')::uuid, 'failed', 'smtp');
  update public.delivery_emails set claimed_at = now() - interval '15 minutes';
  claim := public.claim_delivery_emails(20, 20, 0);
  if pg_temp.sends(claim) <> '{}' or claim->'service_cap' <> '1'
      or not exists (
        select 1 from public.delivery_emails
        where package_id = oldest and status = 'skipped' and reason = 'service_cap' and attempts = 1
      ) then
    raise exception 'A failed email was tried again beyond the allowance: %', claim;
  end if;

  -- A call handles so many scans, the oldest first; the rest wait for the next.
  perform pg_temp.fresh();
  oldest := pg_temp.parcel(alex, 'EMAILTEST3013', '9 hours');
  perform pg_temp.scan(oldest, 'delivered', '5 hours', '3 hours');
  newest := pg_temp.parcel(alex, 'EMAILTEST3014', '9 hours');
  perform pg_temp.scan(newest, 'delivered', '5 hours', '1 hour');
  claim := public.claim_delivery_emails(1, 20, 80);
  if pg_temp.sends(claim) <> array[oldest] or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'A call did not handle its share, oldest first: %', claim;
  end if;
  claim := public.claim_delivery_emails(1, 20, 80);
  if pg_temp.sends(claim) <> array[newest] or (select count(*) from public.delivery_emails) <> 2 then
    raise exception 'The next call did not handle what the first left: %', claim;
  end if;
  if pg_temp.sends(public.claim_delivery_emails(1, 20, 80)) <> '{}' then
    raise exception 'A third call found something left';
  end if;

  begin
    perform public.claim_delivery_emails(0, 20, 80);
    raise exception 'A claim of nothing was accepted' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.claim_delivery_emails(20, -1, 80);
    raise exception 'A negative allowance was accepted' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.claim_delivery_emails(20, 20, null);
    raise exception 'A missing allowance was accepted' using errcode = 'P0001';
  exception when invalid_parameter_value then null; end;
end;
$$;

-- A parcel kept from a lookup joins the account when it is kept, whatever the
-- age of its row. Two lookups share the first parcel, so its key holder gets a
-- copy; the second is taken as it is.
do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  copied jsonb;
  taken jsonb;
  later jsonb;
begin
  perform pg_temp.fresh();
  copied := public.create_one_off_parcel('EMAILKEPT0001', 'unknown', null, null, key_a);
  perform public.create_one_off_parcel('EMAILKEPT0001', 'unknown', null, null, key_b);
  taken := public.create_one_off_parcel('EMAILKEPT0002', 'unknown', null, null, key_a);
  later := public.create_one_off_parcel('EMAILKEPT0003', 'unknown', null, null, key_a);
  -- Looked up three days ago, delivered since: yesterday evening, and today on a day without a time.
  update public.packages set created_at = now() - interval '3 days', current_stage = 'delivered'
  where id in ((copied#>>'{package,id}')::uuid, (taken#>>'{package,id}')::uuid);
  update public.packages set created_at = now() - interval '3 days', current_stage = 'in_transit'
  where id = (later#>>'{package,id}')::uuid;
  update public.tracking_events set created_at = now() - interval '3 days', occurred_at = now() - interval '3 days'
  where package_id in ((copied#>>'{package,id}')::uuid, (taken#>>'{package,id}')::uuid, (later#>>'{package,id}')::uuid);
  perform pg_temp.checked((copied#>>'{package,id}')::uuid, '2 days', 'in_transit');
  perform pg_temp.scan((copied#>>'{package,id}')::uuid, 'delivered', '6 hours', '5 hours');
  perform pg_temp.checked((taken#>>'{package,id}')::uuid, '2 days', 'in_transit');
  perform pg_temp.scan((taken#>>'{package,id}')::uuid, 'delivered', '6 hours', '5 hours', '{"time":"2026-10-03"}');
  perform pg_temp.checked((later#>>'{package,id}')::uuid, '2 days', 'in_transit');
  perform pg_temp.scan((later#>>'{package,id}')::uuid, 'in_transit', '2 days', '2 days');
  if exists (
    select 1 from public.packages where tracking_number like 'EMAILKEPT%' and owned_since is not null
  ) then
    raise exception 'A parcel without an account says when it joined one';
  end if;
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A parcel without an account was claimed';
  end if;
  perform set_config('email_test.copied_link', copied#>>'{link,id}', true);
  perform set_config('email_test.copied_source', copied#>>'{package,id}', true);
  perform set_config('email_test.taken_link', taken#>>'{link,id}', true);
  perform set_config('email_test.taken_package', taken#>>'{package,id}', true);
  perform set_config('email_test.later_link', later#>>'{link,id}', true);
  perform set_config('email_test.later_package', later#>>'{package,id}', true);
end;
$$;

set local role authenticated;
do $$
declare
  key_a constant text := repeat('a', 64);
  answer jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  answer := public.claim_parcel_link(current_setting('email_test.copied_link'), key_a, 'Copied');
  if answer->>'outcome' <> 'kept' or answer->>'package_id' = current_setting('email_test.copied_source') then
    raise exception 'The shared lookup was not kept as a copy: %', answer;
  end if;
  perform set_config('email_test.copied_package', answer->>'package_id', true);
  answer := public.claim_parcel_link(current_setting('email_test.taken_link'), key_a, 'Taken');
  if answer->>'outcome' <> 'kept' or answer->>'package_id' <> current_setting('email_test.taken_package') then
    raise exception 'The lookup nobody else follows was not taken as it is: %', answer;
  end if;
  answer := public.claim_parcel_link(current_setting('email_test.later_link'), key_a, 'Later');
  if answer->>'package_id' <> current_setting('email_test.later_package') then
    raise exception 'The undelivered lookup was not taken as it is: %', answer;
  end if;
end;
$$;

set local role service_role;
do $$
declare
  copied constant uuid := current_setting('email_test.copied_package')::uuid;
  taken constant uuid := current_setting('email_test.taken_package')::uuid;
  later constant uuid := current_setting('email_test.later_package')::uuid;
  claim jsonb;
begin
  if (select count(*) from public.packages
      where id in (copied, taken, later) and owned_since = now() and user_id = 'e1000000-0000-4000-8000-000000000001') <> 3
      or (select created_at from public.packages where id = taken) <> now() - interval '3 days'
      or not exists (select 1 from public.tracking_events where package_id = copied and stage = 'delivered') then
    raise exception 'Kept parcels do not say that they joined the account now';
  end if;
  -- Delivered before it was kept, by a clock time or on a day: never news.
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A parcel delivered before it was kept was claimed: %', claim;
  end if;
  -- The first check after keeping cannot tell either, when the scan has no time.
  perform pg_temp.checked(taken, '-1 minutes', 'delivered');
  perform pg_temp.scan(taken, 'delivered', '6 hours', '-1 minutes', '{"observed_without_provider_timestamp":true}');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'The first answer after keeping a parcel made its delivery news';
  end if;

  -- Kept two hours ago, delivered an hour ago: news, with a clock time.
  update public.packages set owned_since = now() - interval '2 hours', current_stage = 'delivered' where id = later;
  perform pg_temp.scan(later, 'delivered', '1 hour', '55 minutes');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[later] then
    raise exception 'A parcel delivered after it was kept was not claimed: %', claim;
  end if;
  -- And on a day without a time, once a check since it was kept answered without a delivery.
  delete from public.delivery_emails;
  delete from public.tracking_events where package_id = later and stage = 'delivered';
  perform pg_temp.scan(later, 'delivered', '10 hours', '55 minutes', '{"time":"2026-10-03"}');
  if pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'Checks from before a parcel was kept made its delivery news';
  end if;
  perform pg_temp.checked(later, '90 minutes', 'out_for_delivery');
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> array[later] or claim#>>'{send,0,delivered_time}' <> 'date' then
    raise exception 'A kept parcel delivered on a day without a time was not claimed: %', claim;
  end if;
end;
$$;

-- Merging two legs: the delivery that was told from one is not told again from
-- the parcel that stays, which keeps its own joining time and is left out of
-- the email when either leg was.
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  original uuid;
  delivery uuid;
  told uuid;
  claim jsonb;
  ledger public.delivery_emails;
begin
  -- The original leg was told; the delivery leg has a delivered scan of its own.
  perform pg_temp.fresh();
  original := pg_temp.parcel(alex, 'EMAILLEG0001', '3 days');
  told := pg_temp.scan(original, 'delivered', '5 hours', '4 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  perform public.finish_delivery_email((claim#>>'{send,0,id}')::uuid, 'sent');
  delivery := pg_temp.parcel(alex, 'EMAILLEG0002', '2 days');
  perform pg_temp.scan(delivery, 'delivered', '4 hours 50 minutes', '3 hours');
  update public.packages set email_muted = true where id = original;
  if public.link_package_tracking(original, delivery) <> delivery then
    raise exception 'The two legs were not merged';
  end if;
  select * into ledger from public.delivery_emails;
  if ledger.package_id <> delivery or ledger.event_id <> told or ledger.status <> 'sent'
      or (select package_id from public.tracking_events where id = told) <> delivery
      or not (select email_muted from public.packages where id = delivery)
      or (select owned_since from public.packages where id = delivery) <> now() - interval '2 days'
      or (select created_at from public.packages where id = delivery) <> now() - interval '3 days' then
    raise exception 'The merged parcel did not take over the email that was sent: %', ledger;
  end if;
  update public.packages set email_muted = false where id = delivery;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'A merged parcel was emailed again: %', claim;
  end if;
  -- The scan alone says it too, should the row not have moved.
  update public.delivery_emails set package_id = null;
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'A parcel holding a scan that was told was emailed again: %', claim;
  end if;

  -- Both carriers reported the same scan: the original's copy goes, its row stays.
  perform pg_temp.fresh();
  original := pg_temp.parcel(alex, 'EMAILLEG0003', '3 days');
  told := pg_temp.scan(original, 'delivered', '5 hours', '4 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  perform public.finish_delivery_email((claim#>>'{send,0,id}')::uuid, 'sent');
  delivery := pg_temp.parcel(alex, 'EMAILLEG0004', '2 days');
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at, created_at, raw_data)
  select delivery, provider_event_id, stage, description, occurred_at, now() - interval '3 hours', raw_data
  from public.tracking_events where id = told;
  perform public.link_package_tracking(original, delivery);
  select * into ledger from public.delivery_emails;
  if ledger.package_id <> delivery or ledger.event_id is not null or ledger.status <> 'sent'
      or pg_temp.sends(public.claim_delivery_emails(20, 20, 80)) <> '{}' then
    raise exception 'A scan both legs held was told twice: %', ledger;
  end if;

  -- Both legs have a row: each keeps its own, the original's without a parcel.
  perform pg_temp.fresh();
  original := pg_temp.parcel(alex, 'EMAILLEG0005', '3 days');
  perform pg_temp.scan(original, 'delivered', '5 hours', '4 hours');
  delivery := pg_temp.parcel(alex, 'EMAILLEG0006', '2 days');
  perform pg_temp.scan(delivery, 'delivered', '4 hours 50 minutes', '3 hours');
  claim := public.claim_delivery_emails(20, 20, 80);
  if cardinality(pg_temp.sends(claim)) <> 2 then
    raise exception 'Two parcels were not both claimed before they were merged: %', claim;
  end if;
  perform public.link_package_tracking(original, delivery);
  if (select count(*) from public.delivery_emails) <> 2
      or (select count(*) from public.delivery_emails where package_id = delivery) <> 1
      or (select count(*) from public.delivery_emails where package_id is null) <> 1
      or (select email_muted from public.packages where id = delivery) then
    raise exception 'Two claimed legs did not keep a row each';
  end if;

  -- The delivery leg was added when it was already delivered: joining an older
  -- leg does not make that delivery news.
  perform pg_temp.fresh();
  original := pg_temp.parcel(alex, 'EMAILLEG0007', '3 days', 'in_transit');
  perform pg_temp.checked(original, '2 days', 'in_transit');
  perform pg_temp.scan(original, 'in_transit', '2 days', '2 days');
  delivery := pg_temp.parcel(alex, 'EMAILLEG0008', '1 hour');
  perform pg_temp.checked(delivery, '59 minutes', 'delivered');
  perform pg_temp.scan(delivery, 'delivered', '5 hours', '59 minutes');
  perform pg_temp.scan(delivery, 'delivered', '10 hours', '59 minutes', '{"time":"2026-10-03"}');
  perform public.link_package_tracking(original, delivery);
  claim := public.claim_delivery_emails(20, 20, 80);
  if pg_temp.sends(claim) <> '{}' or exists (select 1 from public.delivery_emails) then
    raise exception 'A leg added already delivered was emailed after its merge: %', claim;
  end if;
end;
$$;

-- A row outlives its parcel and its scan, and goes with the account. An
-- account reads the emails it was sent, and nothing else.
do $$
declare
  alex constant uuid := 'e1000000-0000-4000-8000-000000000001';
  other_account constant uuid := 'e1000000-0000-4000-8000-000000000002';
  parcel uuid;
  gone uuid;
  claim jsonb;
begin
  perform pg_temp.fresh();
  perform pg_temp.email(other_account, true);
  parcel := pg_temp.parcel(alex, 'EMAILTEST4001', '9 hours');
  perform pg_temp.scan(parcel, 'delivered', '5 hours', '3 hours');
  gone := pg_temp.parcel(alex, 'EMAILTEST4002', '9 hours');
  perform pg_temp.scan(gone, 'delivered', '5 hours', '2 hours');
  perform pg_temp.scan(pg_temp.parcel(alex, 'EMAILTEST4003', '9 hours'), 'delivered', '5 hours', '1 hour');
  perform pg_temp.scan(pg_temp.parcel(other_account, 'EMAILTEST4004', '9 hours'), 'delivered', '5 hours', '30 minutes');
  claim := public.claim_delivery_emails(20, 20, 80);
  perform public.finish_delivery_email((claim#>>'{send,0,id}')::uuid, 'sent');
  perform public.finish_delivery_email((claim#>>'{send,1,id}')::uuid, 'sent');
  perform public.finish_delivery_email((claim#>>'{send,2,id}')::uuid, 'failed', 'smtp');
  perform public.finish_delivery_email((claim#>>'{send,3,id}')::uuid, 'sent');
  delete from public.packages where id = gone;
  if (select count(*) from public.delivery_emails where user_id = alex) <> 3
      or not exists (
        select 1 from public.delivery_emails
        where user_id = alex and package_id is null and event_id is null and status = 'sent'
      ) then
    raise exception 'A sent email did not outlive its parcel';
  end if;
  perform set_config('email_test.sent_package', parcel::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  emails jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
  select jsonb_agg(to_jsonb(email)) into emails from public.owned_delivery_emails() as email;
  if jsonb_array_length(emails) <> 2
      or not emails @> jsonb_build_array(jsonb_build_object('package_id', current_setting('email_test.sent_package')))
      or not emails @> '[{"package_id":null}]'
      or emails#>>'{0,sent_at}' is null or (select count(*) from jsonb_object_keys(emails->0)) <> 2 then
    raise exception 'An account does not read the emails it was sent: %', emails;
  end if;
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
  if exists (select 1 from public.owned_delivery_emails()) then
    raise exception 'An account read the emails of another';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if exists (select 1 from public.owned_delivery_emails()) then
    raise exception 'Nobody read delivery emails';
  end if;
end;
$$;

reset role;
delete from auth.users where id = 'e1000000-0000-4000-8000-000000000001';
do $$
begin
  if exists (select 1 from public.delivery_emails where user_id = 'e1000000-0000-4000-8000-000000000001')
      or (select count(*) from public.delivery_emails) <> 1 then
    raise exception 'Deleting an account did not delete its delivery emails, and only them';
  end if;
end;
$$;

rollback;
