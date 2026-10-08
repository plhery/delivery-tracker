-- The scraper no longer stages a notice that only announces or reschedules a delivery.
-- DPD's email, date-change and safe-place notices, which carry no carrier stage, were
-- stored as registered from their wording; they now take the in-transit fallback with no
-- source. Mondial Relay's "Prise en charge de votre colis sur notre site logistique de …"
-- is a hub scan, no longer the hand-in it was declared as; the hand-in stays accepted.
--
-- A parcel still synced restages its rows itself; this repairs the rest. A row matches on
-- its carrier, old stage, the provenance it was stored with and its original wording, and
-- keeps its raw evidence and identity. An observation sampling it takes the new decision.
-- The scans move between stages an account can switch off, so every subscription that
-- could have been told gets a receipt and none announces an old scan. Link alerts and Live
-- Activities pass on any non-pending scan whatever its stage, and delivery emails only
-- delivered ones. A parcel's stage moves only where its newest scan set it.
do $$
begin
  create temporary table restaged_scans as
  select event.id, event.package_id, event.created_at, event.stage as old_stage, scans.stage,
    scans.source as old_source, scans.new_source
  from public.tracking_events event
  join (values
    ('dpd', 'registered', null, 'wording:language', 'in_transit', 'none',
      '^We informed you via email that your parcel will be delivered on [A-Z][a-z]+, [A-Z][a-z]+ [0-9]{1,2}, [0-9]{4}( between [0-9]{1,2}:[0-9]{2} [AP]M and [0-9]{1,2}:[0-9]{2} [AP]M)?$'),
    ('dpd', 'registered', null, 'wording:language', 'in_transit', 'none',
      '^Your parcel delivery date has changed, it will be delivered on: [A-Z][a-z]+, [A-Z][a-z]+ [0-9]{1,2}, [0-9]{4}$'),
    ('dpd', 'registered', null, 'wording:language', 'in_transit', 'none',
      '^Your parcel will be delivered to a safe place according to your instructions$'),
    ('mondial-relay', 'accepted', 'accepted', 'carrier_map', 'in_transit', 'carrier_map',
      '^Prise en charge de votre colis sur notre site logistique de .+\.$')
  ) as scans(provider, old_stage, declared, source, stage, new_source, wording)
    on split_part(event.provider_event_id, ':', 1) = scans.provider
    and event.stage = scans.old_stage
    and event.raw_data->>'stage' is not distinct from scans.declared
    and event.raw_data->>'stage_source' = scans.source
    and event.raw_data->>'description' = event.description
    and event.description ~ scans.wording;

  update public.tracking_events event set stage = scan.stage
  from restaged_scans scan where event.id = scan.id;

  update public.tracking_status_observations observation
  set chosen_stage = scan.stage, stage_source = scan.new_source
  from restaged_scans scan
  where observation.sample_event_id = scan.id
    and observation.chosen_stage = scan.old_stage and observation.stage_source = scan.old_source;

  insert into public.push_deliveries (subscription_id, event_id)
  select subscription.id, scan.id
  from restaged_scans scan
  join public.packages parcel on parcel.id = scan.package_id
  join public.push_subscriptions subscription on subscription.user_id = parcel.user_id
    and subscription.subscribed_at < scan.created_at
  on conflict (subscription_id, event_id) do nothing;
  insert into public.native_push_deliveries (device_id, event_id)
  select device.id, scan.id
  from restaged_scans scan
  join public.packages parcel on parcel.id = scan.package_id
  join public.native_push_devices device on device.user_id = parcel.user_id
    and device.subscribed_at < scan.created_at
  on conflict (device_id, event_id) do nothing;

  -- The newest non-pending scan, as the app and worker select it, before and after.
  update public.packages parcel set current_stage = latest.stage
  from (select distinct package_id from restaged_scans) affected
  cross join lateral (
    select event.stage from public.tracking_events event
    where event.package_id = affected.package_id and event.stage <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'], event.stage) desc,
      event.id desc
    limit 1
  ) latest
  cross join lateral (
    select coalesce(scan.old_stage, event.stage) as stage
    from public.tracking_events event left join restaged_scans scan on scan.id = event.id
    where event.package_id = affected.package_id and coalesce(scan.old_stage, event.stage) <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'],
        coalesce(scan.old_stage, event.stage)) desc,
      event.id desc
    limit 1
  ) previous
  where parcel.id = affected.package_id
    and parcel.current_stage = previous.stage
    and latest.stage <> previous.stage;

  drop table restaged_scans;
end;
$$;

insert into public.applied_migrations (name) values ('20261008040000_delivery_notice_and_relay_hub_stages') on conflict do nothing;
