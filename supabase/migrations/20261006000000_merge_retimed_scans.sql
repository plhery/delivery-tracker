-- Two scraper fixes moved the instant of scans that are already stored. The sync upserts
-- on an identity that hashes the scan's time, so such a scan comes back as a second row.
-- The first row stored keeps its id, creation time and receipts, and takes the corrected
-- instant, identity and details. Run it once the server with those fixes is deployed.
--
-- 1. Cainiao's own "Carrier update" notice has no zone. It was read as UTC and is Beijing
--    time, eight hours earlier. Only a row whose identity still hashes its own strings is
--    moved, to the identity the sync now computes, whether its second row exists yet or not.
-- 2. A provider's copy of a Correos scan keeps Correos' Madrid wall clock labelled UTC, one
--    or two hours after the scan Correos itself reports once it tracks the parcel. Only an
--    existing pair is merged: the copy's UTC clock reads the same as the Correos scan's
--    Madrid clock, each has no other such match, and no copy of that parcel shares an
--    instant with a Correos scan, which would show a provider that reports real instants.
do $$
declare
  receipt record;
begin
  create temporary table retimed_scans (
    kept_id uuid primary key,
    copy_id uuid unique,
    occurred_at timestamptz not null,
    provider_event_id text not null,
    stage text not null,
    description text not null,
    location text,
    raw_data jsonb not null
  );

  insert into retimed_scans
  with notices as (
    select event.id, event.package_id, event.stage, event.description, event.location, event.raw_data,
      (event.raw_data->>'time')::timestamp at time zone 'Asia/Shanghai' as occurred_at,
      replace(event.raw_data->>'time', ' ', 'T') || '+08:00' as scan_time
    from public.tracking_events event
    where event.description = 'Carrier update'
      and nullif(btrim(event.location), '') is null
      and event.raw_data->>'time' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
      and event.occurred_at = (event.raw_data->>'time')::timestamp at time zone 'UTC'
      and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
      and event.provider_event_id = 'aliexpress:' || encode(sha256(convert_to(
        '["aliexpress",' || to_json(event.raw_data->>'time')::text || ',"","Carrier update"]', 'UTF8')), 'hex')
  ), keyed as (
    select notices.*, 'aliexpress:' || encode(sha256(convert_to(
      '["aliexpress",' || to_json(scan_time)::text || ',"","Carrier update"]', 'UTF8')), 'hex') as identity
    from notices
  )
  select keyed.id, copy.id, keyed.occurred_at, keyed.identity, keyed.stage, keyed.description, keyed.location,
    coalesce(copy.raw_data, keyed.raw_data || jsonb_build_object('time', keyed.scan_time)
      || case when keyed.raw_data ? 'instant' then jsonb_build_object('instant', keyed.scan_time) else '{}'::jsonb end)
  from keyed
  left join public.tracking_events copy
    on copy.package_id = keyed.package_id and copy.provider_event_id = keyed.identity;

  insert into retimed_scans
  with copies as (
    select event.* from public.tracking_events event
    where event.provider_event_id like 'unknown:%'
      and event.raw_data->>'time' ~ 'Z$'
      and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
  ), own as (
    select event.* from public.tracking_events event
    where event.provider_event_id like 'correos-spain:%'
      and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
  ), pairs as (
    select copies.id as provider_id, copies.created_at as provider_created_at, own.id as own_id,
      own.created_at as own_created_at, copies.package_id,
      count(*) over (partition by copies.id) as own_matches,
      count(*) over (partition by own.id) as provider_matches
    from copies
    join own on own.package_id = copies.package_id
      and own.occurred_at at time zone 'Europe/Madrid' = copies.occurred_at at time zone 'UTC'
  )
  select
    case when pairs.own_created_at < pairs.provider_created_at then pairs.own_id else pairs.provider_id end,
    case when pairs.own_created_at < pairs.provider_created_at then pairs.provider_id else pairs.own_id end,
    own.occurred_at, own.provider_event_id, own.stage, own.description, own.location, own.raw_data
  from pairs
  join own on own.id = pairs.own_id
  where pairs.own_matches = 1 and pairs.provider_matches = 1
    and not exists (
      select 1 from copies same_instant
      join own other on other.package_id = same_instant.package_id and other.occurred_at = same_instant.occurred_at
      where same_instant.package_id = pairs.package_id
    );

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'),
    ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, scan.kept_id, min(r.sent_at)
       from public.%I r join retimed_scans scan on scan.copy_id = r.event_id
       group by r.%I, scan.kept_id
       on conflict (%I, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at)',
      receipt.table_name, receipt.owner_column, receipt.owner_column,
      receipt.table_name, receipt.owner_column, receipt.owner_column
    );
  end loop;

  insert into public.live_activity_event_deliveries as kept (
    device_id, event_id, package_id, delivery_kind, event_created_at, sent_at
  )
  select distinct on (r.device_id, scan.kept_id)
    r.device_id, scan.kept_id, r.package_id, r.delivery_kind, event.created_at, r.sent_at
  from public.live_activity_event_deliveries r
  join retimed_scans scan on scan.copy_id = r.event_id
  join public.tracking_events event on event.id = scan.kept_id
  order by r.device_id, scan.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation
  set sample_event_id = scan.kept_id
  from retimed_scans scan where observation.sample_event_id = scan.copy_id;

  -- One email per scan: the kept row's own stands, else it takes the copy's.
  update public.delivery_emails email
  set event_id = scan.kept_id
  from retimed_scans scan
  where email.event_id = scan.copy_id
    and not exists (select 1 from public.delivery_emails told where told.event_id = scan.kept_id);

  delete from public.tracking_events event
  using retimed_scans scan where event.id = scan.copy_id;

  update public.tracking_events kept
  set occurred_at = scan.occurred_at, provider_event_id = scan.provider_event_id, stage = scan.stage,
    description = scan.description, location = scan.location, raw_data = scan.raw_data
  from retimed_scans scan where kept.id = scan.kept_id;

  drop table retimed_scans;
end;
$$;
