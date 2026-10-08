-- Four kinds of copy the earlier merges left, each kept as a second row of one scan:
--
-- - 17TRACK's India Post take-offs. India Post dates a take-off with the departure airport's
--   wall clock labelled UTC, and 17TRACK takes the label at its word, hours from the flight.
--   The scraper now leaves them out. Such a row ("Aircraft Departure" or "UPLIFT") pairs with
--   India Post's own take-off whose wall clock reads as 17TRACK's UTC time.
-- - Two rows of one source alike in time, wording, place, stage and provider code: an
--   identity rewritten in place, then the scan stored again under its current identity.
-- - One scan dated to the minute by one source and to the second by another, or by the same
--   source in another check (Chronopost's history once came through La Poste's feed). The
--   wording and stage are the same, the time to the minute is the minute the other falls in,
--   and a source's two rows were stored apart: the rows one check stores together are the
--   scans of one reply, and Swiss Post sorts a parcel twice within a minute.
-- - A stage change the sync observed without a provider time, stored with a dated scan of
--   the same source, stage and wording. A later re-staging gave the dated scan that stage.
--
-- Each row must pair uniquely, and a row in two pairs of any kind stays. The first row stored
-- keeps its id, creation time and receipts and takes the scan: India Post's take-off, the
-- current identity, or the time to the second. An observed row always gives way to its dated
-- scan. A watermark the copies alone explain moves back.
do $$
declare
  receipt record;
begin
  lock table public.packages, public.tracking_events in share row exclusive mode;

  create temporary table scan_copies as
  with scans as materialized (
    select event.id, event.package_id, event.occurred_at, event.created_at, event.stage, event.description,
      event.location, event.raw_data, split_part(event.provider_event_id, ':', 1) as source,
      lower(regexp_replace(btrim(coalesce(event.description, '')), '\s+', ' ', 'g')) as wording,
      coalesce(event.raw_data->>'observed_without_provider_timestamp' = 'true', false) as observed,
      -- The UTC digits of 17TRACK's time for an India Post take-off, read only where it is one.
      case when event.provider_event_id like 'unknown:%' and event.raw_data->>'reporting_carrier' = 'India Post'
          and lower(btrim(coalesce(event.description, ''))) in ('aircraft departure', 'uplift')
          and event.raw_data->>'provider_time_iso'
            ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?([+-]\d{2}:\d{2}|Z)$'
        then to_char((event.raw_data->>'provider_time_iso')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
      end as take_off_utc
    from public.tracking_events event
    where event.provider_event_id like '%:%' and event.provider_event_id not like 'app:%'
  ), pairs as (
    select 'take_off' as kind, copy.id as copy_row, own.id as own_row
    from scans copy
    join scans own on own.package_id = copy.package_id and own.source = 'india-post' and not own.observed
      and own.raw_data->>'provider_code' = 'AircraftTakeOff' and left(own.raw_data->>'time', 19) = copy.take_off_utc
    where not copy.observed and copy.take_off_utc is not null
    union all
    select 'identical', earlier.id, later.id
    from scans earlier
    join scans later on later.package_id = earlier.package_id and later.source = earlier.source and not later.observed
      and (later.created_at, later.id) > (earlier.created_at, earlier.id)
      and later.occurred_at = earlier.occurred_at and later.description is not distinct from earlier.description
      and later.location is not distinct from earlier.location and later.stage is not distinct from earlier.stage
      and later.raw_data->>'provider_code' is not distinct from earlier.raw_data->>'provider_code'
    where not earlier.observed
    union all
    select 'minute', minute.id, precise.id
    from scans minute
    join scans precise on precise.package_id = minute.package_id and not precise.observed
      and date_trunc('minute', precise.occurred_at) = minute.occurred_at and precise.occurred_at <> minute.occurred_at
      and precise.wording = minute.wording and precise.stage is not distinct from minute.stage
      and (precise.source = 'unknown' or minute.source = 'unknown'
        or (precise.source = minute.source and precise.created_at <> minute.created_at))
    where not minute.observed and minute.wording <> '' and minute.occurred_at = date_trunc('minute', minute.occurred_at)
    union all
    select 'observed', observation.id, dated.id
    from scans observation
    join scans dated on dated.package_id = observation.package_id and dated.source = observation.source
      and not dated.observed and dated.created_at = observation.created_at and dated.stage = observation.stage
      and dated.description = observation.description
    where observation.observed
  ), unique_pairs as (
    select pairs.* from pairs
    where (select count(*) from pairs other where pairs.copy_row in (other.copy_row, other.own_row)
      or pairs.own_row in (other.copy_row, other.own_row)) = 1
  )
  select
    case when pairs.kind = 'observed' or own.created_at <= copy.created_at then own.id else copy.id end as kept_id,
    case when pairs.kind = 'observed' or own.created_at <= copy.created_at then copy.id else own.id end as copy_id,
    own.package_id, case when pairs.kind <> 'observed' then copy.occurred_at end as copy_at,
    own.occurred_at, own.provider_event_id, own.stage, own.description, own.location, own.raw_data
  from unique_pairs pairs
  join public.tracking_events copy on copy.id = pairs.copy_row
  join public.tracking_events own on own.id = pairs.own_row;

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'), ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, scan.kept_id, min(r.sent_at)
       from public.%I r join scan_copies scan on scan.copy_id = r.event_id
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
  join scan_copies scan on scan.copy_id = r.event_id
  join public.tracking_events event on event.id = scan.kept_id
  order by r.device_id, scan.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation set sample_event_id = scan.kept_id
  from scan_copies scan where observation.sample_event_id = scan.copy_id;
  update public.delivery_emails email set event_id = scan.kept_id
  from scan_copies scan where email.event_id = scan.copy_id
    and not exists (select 1 from public.delivery_emails told where told.event_id = scan.kept_id);

  delete from public.tracking_events event using scan_copies scan where event.id = scan.copy_id;
  update public.tracking_events kept
  set occurred_at = scan.occurred_at, provider_event_id = scan.provider_event_id, stage = scan.stage,
    description = scan.description, location = scan.location, raw_data = scan.raw_data
  from scan_copies scan where kept.id = scan.kept_id and kept.provider_event_id <> scan.provider_event_id;

  -- A watermark (possibly capped by the check time) past every remaining scan, and no later
  -- than a copy, came from the copies, so fresh scans could look older than it.
  update public.packages parcel
  set carrier_data = parcel.carrier_data || jsonb_build_object('routing', (parcel.carrier_data->'routing')
    || jsonb_build_object('last_event_at', to_char(clocks.latest at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  from (
    select scan.package_id, max(scan.copy_at) as copy_latest,
      (select max(event.occurred_at) from public.tracking_events event
        where event.package_id = scan.package_id and event.provider_event_id not like 'app:%'
          and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true') as latest
    from scan_copies scan where scan.copy_at is not null group by scan.package_id
  ) clocks
  where parcel.id = clocks.package_id
    and jsonb_typeof(parcel.carrier_data->'routing') = 'object'
    and (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz > clocks.latest
    and (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz <= clocks.copy_latest;

  drop table scan_copies;
end;
$$;

insert into public.applied_migrations (name) values ('20261008200100_remaining_scan_copies') on conflict do nothing;
