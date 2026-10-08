-- A universal provider whose clock is off by a zone's offset from UTC words a carrier's scans
-- its own way at the wrong instant: ParcelsApp put Paack's scans two hours early, and a
-- provider read a Cainiao notice's Beijing clock as UTC. The sync stored such copies beside
-- the carrier's rows of the same scans. It now keeps one row per scan on the carrier's clock;
-- this merges the copies already stored.
--
-- A copy is a universal row a whole number of quarter hours, from one to 14 hours, from a
-- carrier's row of the parcel, to a second other than zero, with the same stage or one of
-- them pending. Neither has a row of the other kind at its own instant, and each copy and row
-- must pair uniquely. The first row stored keeps its id, creation time and receipts and takes
-- the carrier's scan. A watermark the copies alone explain moves back. Times to the minute
-- and offsets under an hour stand: distinct scans fall that way too.
do $$
declare
  receipt record;
begin
  lock table public.packages, public.tracking_events in share row exclusive mode;

  create temporary table clock_copies as
  with scans as materialized (
    select event.*, event.provider_event_id like 'unknown:%' as universal
    from public.tracking_events event
    where event.provider_event_id like '%:%' and event.provider_event_id not like 'app:%'
      and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
  ), pairs as (
    select copies.id as copy_row, copies.created_at as copy_created, copies.occurred_at as copy_at,
      own.id as own_row, own.created_at as own_created,
      count(*) over (partition by copies.id) as own_matches,
      count(*) over (partition by own.id) as copy_matches
    from scans copies
    join scans own on own.package_id = copies.package_id and not own.universal
      and abs(extract(epoch from copies.occurred_at - own.occurred_at)) between 3600 and 14 * 3600
      and mod(extract(epoch from copies.occurred_at - own.occurred_at), 900) = 0
      and floor(extract(epoch from own.occurred_at))::bigint % 60 <> 0
      and (copies.stage = own.stage or 'pending' in (copies.stage, own.stage))
    where copies.universal
      and not exists (select 1 from scans twin where twin.package_id = copies.package_id
        and not twin.universal and twin.occurred_at = copies.occurred_at)
      and not exists (select 1 from scans twin where twin.package_id = own.package_id
        and twin.universal and twin.occurred_at = own.occurred_at)
  )
  select
    case when pairs.copy_created < pairs.own_created then pairs.copy_row else pairs.own_row end as kept_id,
    case when pairs.copy_created < pairs.own_created then pairs.own_row else pairs.copy_row end as copy_id,
    own.package_id, pairs.copy_at, own.occurred_at, own.provider_event_id, own.stage, own.description,
    own.location, own.raw_data
  from pairs
  join public.tracking_events own on own.id = pairs.own_row
  where pairs.own_matches = 1 and pairs.copy_matches = 1;

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'), ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, scan.kept_id, min(r.sent_at)
       from public.%I r join clock_copies scan on scan.copy_id = r.event_id
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
  join clock_copies scan on scan.copy_id = r.event_id
  join public.tracking_events event on event.id = scan.kept_id
  order by r.device_id, scan.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation set sample_event_id = scan.kept_id
  from clock_copies scan where observation.sample_event_id = scan.copy_id;
  update public.delivery_emails email set event_id = scan.kept_id
  from clock_copies scan where email.event_id = scan.copy_id
    and not exists (select 1 from public.delivery_emails told where told.event_id = scan.kept_id);

  delete from public.tracking_events event using clock_copies scan where event.id = scan.copy_id;
  update public.tracking_events kept
  set occurred_at = scan.occurred_at, provider_event_id = scan.provider_event_id, stage = scan.stage,
    description = scan.description, location = scan.location, raw_data = scan.raw_data
  from clock_copies scan where kept.id = scan.kept_id and kept.provider_event_id <> scan.provider_event_id;

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
    from clock_copies scan group by scan.package_id
  ) clocks
  where parcel.id = clocks.package_id
    and jsonb_typeof(parcel.carrier_data->'routing') = 'object'
    and (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz > clocks.latest
    and (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz <= clocks.copy_latest;

  drop table clock_copies;
end;
$$;

insert into public.applied_migrations (name) values ('20261008030000_universal_clock_copies') on conflict do nothing;
