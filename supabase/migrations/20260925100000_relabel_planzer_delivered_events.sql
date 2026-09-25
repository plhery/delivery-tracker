-- Planzer's English API labels its delivery milestone "Shipped", a translation
-- slip for "Zugestellt" (Livré, Consegnato); the adapter now stores it as
-- "Delivered". Event identities hash the stored wording (providerEventId in
-- src/server/trackingSync.ts), so a saved "Shipped" row would gain a
-- "Delivered" copy on its next refresh, and delivered or archived parcels,
-- which no longer refresh, would keep the old wording. Relabel the saved rows
-- and move them to the identity the host now computes. Row ids, stages,
-- timestamps and notification receipts are unchanged.
--
-- A row qualifies only when its identity reproduces the host's hash of the
-- "Shipped" wording, which proves where it came from. When a refresh has
-- already saved the same milestone under the new identity, the older of the
-- two rows is kept. One DO block keeps the steps ordered and atomic.
do $$
begin
  create temporary table planzer_shipped_events as
  select event.id, event.package_id, event.created_at, identity.new_id
  from public.tracking_events as event
  cross join lateral (
    select split_part(event.provider_event_id, ':', 1) as carrier,
      -- JSON.stringify([carrierId, rawTime, location, description]), as hashed by the host.
      format('[%s,%s,%s,', to_json(split_part(event.provider_event_id, ':', 1)),
        to_json(coalesce(event.raw_data ->> 'time', '')),
        to_json(btrim(coalesce(event.raw_data ->> 'location', '')))) as material
  ) as source
  cross join lateral (
    select source.carrier || ':' || encode(sha256(convert_to(
        source.material || '"Shipped"]', 'UTF8')), 'hex') as old_id,
      source.carrier || ':' || encode(sha256(convert_to(
        source.material || '"Delivered"]', 'UTF8')), 'hex') as new_id
  ) as identity
  where source.carrier in ('quickpac', 'planzer')
    and event.description = 'Shipped'
    and event.stage = 'delivered'
    and event.raw_data ->> 'description' = 'Shipped'
    and event.provider_event_id = identity.old_id;

  -- A newer copy under the new identity is the duplicate.
  delete from public.tracking_events as copy
  using planzer_shipped_events as shipped
  where copy.package_id = shipped.package_id
    and copy.provider_event_id = shipped.new_id
    and (copy.created_at, copy.id) > (shipped.created_at, shipped.id);

  -- An older copy already carries the new wording and identity.
  delete from public.tracking_events as event
  using planzer_shipped_events as shipped
  where event.id = shipped.id
    and exists (
      select 1 from public.tracking_events as copy
      where copy.package_id = shipped.package_id and copy.provider_event_id = shipped.new_id
    );

  update public.tracking_events as event
  set description = 'Delivered',
    provider_event_id = shipped.new_id,
    raw_data = jsonb_set(event.raw_data, '{description}', to_jsonb('Delivered'::text))
  from planzer_shipped_events as shipped
  where event.id = shipped.id;

  drop table planzer_shipped_events;
end;
$$;
