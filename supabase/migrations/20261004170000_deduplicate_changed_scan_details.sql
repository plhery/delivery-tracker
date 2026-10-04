-- Keep the original scan and its receipts, with the latest known details.
-- Only known wording variants or a newly supplied location qualify.
do $$
declare
  receipt record;
begin
  create temporary table changed_scan_copies as
  with india_wording(code, wording, scan_kind) as (values
    ('ItemInducted', 'inducted', 'inducted'),
    ('ItemInducted', 'item inducted', 'inducted'),
    ('MailArrived', 'arrived at sorting centre', 'arrived'),
    ('ItemReceived', 'item received', 'received'),
    ('ExportCustoms', 'sent to export customs', 'sent to customs'),
    ('ExportCustoms', 'out of export customs', 'out of customs'),
    ('ItemTransfered', 'transferred to office of exchange', 'transferred'),
    ('ItemTransfered', 'transfer to ooe (otb)', 'transferred'),
    ('ItemDispatched', 'dispatched', 'dispatched'),
    ('ItemDispatched', 'item dispatch', 'dispatched')
  ), eligible as (
    select event.*, 'india-post' as source, wording.code, wording.scan_kind,
      lower(btrim(regexp_replace(location, '([[:space:]]+[0-9]+)+[[:space:]]*$', ''))) as office
    from public.tracking_events event
    join india_wording wording on wording.code = raw_data->>'provider_code'
      and wording.wording = lower(btrim(regexp_replace(description, '[[:space:]]+', ' ', 'g')))
    where provider_event_id like 'india-post:%'
      and nullif(btrim(location), '') is not null
      and coalesce(raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
    union all
    select event.*, 'ups' as source, '' as code,
      lower(btrim(regexp_replace(description, '[[:space:]]+', ' ', 'g'))) as scan_kind, '' as office
    from public.tracking_events event
    where provider_event_id like 'ups:%' and stage <> 'unknown'
      and nullif(btrim(description), '') is not null
      and coalesce(raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
  ), matches as (
    select package_id, occurred_at, stage, source, code, scan_kind, office,
      (array_agg(id order by created_at, id))[1] as kept_id,
      (array_agg(id order by (nullif(btrim(location), '') is not null) desc, created_at desc, id desc))[1] as detail_id
    from eligible
    group by package_id, occurred_at, stage, source, code, scan_kind, office
    having count(*) > 1 and count(distinct created_at) = count(*)
      and (source = 'india-post' or (
        count(distinct nullif(lower(btrim(regexp_replace(location, '[[:space:]]+', ' ', 'g'))), '')) = 1
        and bool_or(nullif(btrim(location), '') is null)
      ))
  )
  select event.id as copy_id, matches.kept_id, matches.detail_id
  from eligible event join matches using (package_id, occurred_at, stage, source, code, scan_kind, office)
  where event.id <> matches.kept_id;

  update public.tracking_events kept
  set description = detail.description, location = detail.location, raw_data = detail.raw_data
  from (select distinct kept_id, detail_id from changed_scan_copies) copies
  join public.tracking_events detail on detail.id = copies.detail_id
  where kept.id = copies.kept_id;

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'),
    ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, copy.kept_id, min(r.sent_at)
       from public.%I r join changed_scan_copies copy on copy.copy_id = r.event_id
       group by r.%I, copy.kept_id
       on conflict (%I, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at)',
      receipt.table_name, receipt.owner_column, receipt.owner_column,
      receipt.table_name, receipt.owner_column, receipt.owner_column
    );
  end loop;

  insert into public.live_activity_event_deliveries as kept (
    device_id, event_id, package_id, delivery_kind, event_created_at, sent_at
  )
  select distinct on (r.device_id, copy.kept_id)
    r.device_id, copy.kept_id, r.package_id, r.delivery_kind, event.created_at, r.sent_at
  from public.live_activity_event_deliveries r
  join changed_scan_copies copy on copy.copy_id = r.event_id
  join public.tracking_events event on event.id = copy.kept_id
  order by r.device_id, copy.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation
  set sample_event_id = copy.kept_id
  from changed_scan_copies copy where observation.sample_event_id = copy.copy_id;

  delete from public.tracking_events event
  using changed_scan_copies copy where event.id = copy.copy_id;

  drop table changed_scan_copies;
end;
$$;
