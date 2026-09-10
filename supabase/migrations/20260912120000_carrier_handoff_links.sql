-- Extend exact-reference reconciliation to postal partners and parcels already switched to their delivery carrier.
-- Link two verified legs of the same shipment. The delivery leg remains the
-- canonical parcel, so its carrier continues supplying status and ETA updates.
create or replace function public.link_package_tracking(p_original_id uuid, p_delivery_id uuid)
returns uuid
language plpgsql
set search_path = pg_catalog
as $$
declare
  original public.packages;
  delivery public.packages;
  combined_label text;
begin
  if p_original_id = p_delivery_id then
    raise exception 'Choose two different parcels' using errcode = '22023';
  end if;
  perform id from public.sync_jobs where package_id in (p_original_id, p_delivery_id) order by id for update;
  perform id from public.packages where id in (p_original_id, p_delivery_id) order by id for update;
  select * into original from public.packages where id = p_original_id;
  select * into delivery from public.packages where id = p_delivery_id;
  if original.id is null and delivery.carrier_data->>'original_package_id' = p_original_id::text then
    return p_delivery_id; -- Safe retry after a completed link.
  end if;
  if original.id is null or delivery.id is null then
    raise exception 'Parcel not found' using errcode = '22023';
  end if;
  if original.user_id is distinct from delivery.user_id or original.user_id is null then
    raise exception 'Parcels must belong to the same account' using errcode = '22023';
  end if;
  if original.carrier_data ? 'original_package_id'
    or (original.carrier_data ? 'original_carrier' and original.carrier_data->>'original_carrier' <> original.carrier)
    or delivery.carrier_data ? 'original_carrier' then
    raise exception 'Parcel already has linked tracking' using errcode = '22023';
  end if;
  combined_label := concat_ws(' / ', nullif(btrim(original.label), ''), nullif(btrim(delivery.label), ''));
  if char_length(combined_label) > 80 then
    raise exception 'Combined parcel name exceeds 80 characters' using errcode = '22023';
  end if;

  -- Keep the delivery carrier's copy of an event if both trackers supplied it.
  delete from public.tracking_events earlier
  using public.tracking_events later
  where earlier.package_id = p_original_id and later.package_id = p_delivery_id
    and earlier.provider_event_id = later.provider_event_id;
  update public.tracking_events set package_id = p_delivery_id where package_id = p_original_id;

  update public.packages set
    label = combined_label,
    created_at = least(original.created_at, delivery.created_at),
    notifications_muted = original.notifications_muted or delivery.notifications_muted,
    tracking_generation = gen_random_uuid(),
    carrier_data = coalesce(delivery.carrier_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'original_package_id', original.id,
      'original_carrier', original.carrier,
      'original_tracking_number', original.tracking_number,
      'original_tracking_url', original.tracking_url,
      'active_tracking_carrier', delivery.carrier,
      'active_tracking_number', delivery.tracking_number,
      'sender_name', coalesce(original.carrier_data->>'sender_name', delivery.carrier_data->>'sender_name')
    ))
  where id = p_delivery_id;
  update public.sync_jobs set package_id = p_delivery_id where package_id = p_original_id;
  update public.tracking_sync_attempts set package_id = p_delivery_id where package_id = p_original_id;
  delete from public.packages where id = p_original_id;
  return p_delivery_id;
end;
$$;

revoke all on function public.link_package_tracking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_package_tracking(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

-- Carrier references are populated only by server adapters after verifying the
-- requested shipment. Never infer identity from labels, senders or number prefixes.
create or replace function public.auto_link_package_tracking(p_user_id uuid default null)
returns integer
language plpgsql
set search_path = pg_catalog
as $$
declare
  pair record;
  linked_count integer := 0;
begin
  -- Reconciliation is brief and serial; tracking requests remain concurrent.
  perform pg_advisory_xact_lock(846120260910);
  for pair in
    with matches as (
      select original.id as original_id, delivery.id as delivery_id,
        count(*) over (partition by original.id) as delivery_matches,
        count(*) over (partition by delivery.id) as original_matches
      from public.packages original
      join public.packages delivery on delivery.user_id = original.user_id
        and delivery.id <> original.id
        and delivery.carrier = 'swiss-post'
        and delivery.archived_at is null
        and not (delivery.carrier_data ? 'original_carrier')
        and delivery.current_stage not in ('pending', 'registered')
        and ((delivery.carrier_data->>'international_tracking_number' ~ '^[A-Z0-9]{4,40}$'
          and delivery.carrier_data->>'international_tracking_number' = coalesce(
            nullif(original.carrier_data->>'original_canonical_tracking_number', ''),
            case when original.carrier_data->>'active_tracking_carrier' is distinct from 'swiss-post'
              then nullif(original.carrier_data->>'canonical_tracking_number', '') end,
            original.tracking_number))
          or (original.carrier_data->>'active_tracking_carrier' = 'swiss-post'
            and original.carrier_data->>'active_tracking_number' = delivery.tracking_number))
      where original.carrier <> 'swiss-post'
        and original.archived_at is null
        and (not (original.carrier_data ? 'original_package_id')
          and (not (original.carrier_data ? 'original_carrier') or original.carrier_data->>'original_carrier' = original.carrier))
        and (p_user_id is null or original.user_id = p_user_id)
    )
    select * from matches where delivery_matches = 1 and original_matches = 1
    order by original_id, delivery_id
  loop
    -- Lock jobs before packages, matching the worker's lease-write lock order.
    perform id from public.sync_jobs where package_id in (pair.original_id, pair.delivery_id) order by id for update;
    perform id from public.packages where id in (pair.original_id, pair.delivery_id) order by id for update;
    -- A carrier edit, archive, manual link or deletion may have raced selection.
    if exists (
      select 1 from public.packages original join public.packages delivery
        on original.user_id = delivery.user_id
      where original.id = pair.original_id and delivery.id = pair.delivery_id
        and original.carrier <> 'swiss-post' and delivery.carrier = 'swiss-post'
        and original.archived_at is null and delivery.archived_at is null
        and (not (original.carrier_data ? 'original_package_id')
          and (not (original.carrier_data ? 'original_carrier') or original.carrier_data->>'original_carrier' = original.carrier)) and not (delivery.carrier_data ? 'original_carrier')
        and delivery.current_stage not in ('pending', 'registered')
        and ((delivery.carrier_data->>'international_tracking_number' ~ '^[A-Z0-9]{4,40}$'
          and delivery.carrier_data->>'international_tracking_number' = coalesce(
            nullif(original.carrier_data->>'original_canonical_tracking_number', ''),
            case when original.carrier_data->>'active_tracking_carrier' is distinct from 'swiss-post'
              then nullif(original.carrier_data->>'canonical_tracking_number', '') end,
            original.tracking_number))
          or (original.carrier_data->>'active_tracking_carrier' = 'swiss-post'
            and original.carrier_data->>'active_tracking_number' = delivery.tracking_number))
        and char_length(concat_ws(' / ', nullif(btrim(original.label), ''), nullif(btrim(delivery.label), ''))) <= 80
    ) then
      perform public.link_package_tracking(pair.original_id, pair.delivery_id);
      linked_count := linked_count + 1;
    end if;
  end loop;
  return linked_count;
end;
$$;

revoke all on function public.auto_link_package_tracking(uuid) from public, anon, authenticated;
grant execute on function public.auto_link_package_tracking(uuid) to service_role;
notify pgrst, 'reload schema';
