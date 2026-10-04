-- Rewording a take-off must not create a second scan or notification.
-- Keep the oldest row and transfer receipts before removing its copies.
do $$
declare
  receipt record;
begin
  create temporary table india_post_flight_copies as
  select id as copy_id, kept_id from (
    select id, first_value(id) over (
      partition by package_id, occurred_at, location
      order by created_at, id
    ) as kept_id
    from public.tracking_events
    where provider_event_id like 'india-post:%'
      and raw_data->>'provider_code' = 'AircraftTakeOff'
      and stage = 'in_transit'
      and description in ('UPLIFT', 'Aircraft Departure', 'Aircraft Take Off', 'AIRCRAFT_DEPARTURE')
      and nullif(btrim(location), '') is not null
  ) as flights where id <> kept_id;

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'),
    ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, copy.kept_id, min(r.sent_at)
       from public.%I r join india_post_flight_copies copy on copy.copy_id = r.event_id
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
  join india_post_flight_copies copy on copy.copy_id = r.event_id
  join public.tracking_events event on event.id = copy.kept_id
  order by r.device_id, copy.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation
  set sample_event_id = copy.kept_id
  from india_post_flight_copies copy where observation.sample_event_id = copy.copy_id;

  delete from public.tracking_events event
  using india_post_flight_copies copy where event.id = copy.copy_id;

  drop table india_post_flight_copies;
end;
$$;
