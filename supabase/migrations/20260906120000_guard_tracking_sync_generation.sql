-- Carrier corrections can finish while a worker is awaiting the old carrier.
-- A generation token also detects A -> B -> A and resets to the same carrier.
alter table public.packages
  add column tracking_generation uuid not null default gen_random_uuid();

create function public.renew_tracking_generation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.tracking_generation := gen_random_uuid();
  return new;
end;
$$;

create trigger packages_renew_tracking_generation
  before update of carrier, tracking_number, tracking_url, dpd_postcode
  on public.packages
  for each row execute function public.renew_tracking_generation();

revoke all on function public.renew_tracking_generation() from public, anon, authenticated;

-- All tracking writes, including "syncing", waiting and error states, use this
-- service-only transaction. The row lock serializes it with the carrier reset;
-- a stale generation cannot insert events, delete history or change any field.
create function public.apply_tracking_sync(
  p_package_id uuid,
  p_tracking_generation uuid,
  p_values jsonb,
  p_events jsonb default '[]'::jsonb,
  p_delete_descriptions text[] default '{}'::text[]
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  values_row public.packages;
begin
  perform 1 from public.packages
  where id = p_package_id and tracking_generation = p_tracking_generation
  for update;
  if not found then return false; end if;

  if jsonb_typeof(p_values) is distinct from 'object'
      or jsonb_typeof(p_events) is distinct from 'array'
      or (p_values - array[
        'current_stage', 'expected_delivery', 'last_status_text', 'last_synced_at',
        'sync_status', 'sync_error', 'carrier_data'
      ]) <> '{}'::jsonb then
    raise exception 'Invalid tracking sync payload' using errcode = '22023';
  end if;
  values_row := jsonb_populate_record(null::public.packages, p_values);

  insert into public.tracking_events (
    package_id, provider_event_id, stage, description, location, occurred_at, raw_data
  )
  select p_package_id, event.provider_event_id, event.stage,
    event.description, event.location, event.occurred_at, coalesce(event.raw_data, '{}'::jsonb)
  from jsonb_to_recordset(p_events) as event(
    provider_event_id text, stage text, description text,
    location text, occurred_at timestamptz, raw_data jsonb
  )
  on conflict (package_id, provider_event_id) do update set
    stage = excluded.stage,
    description = excluded.description,
    location = excluded.location,
    occurred_at = excluded.occurred_at,
    raw_data = excluded.raw_data;

  delete from public.tracking_events
  where package_id = p_package_id and description = any(p_delete_descriptions);

  update public.packages set
    current_stage = case when p_values ? 'current_stage' then values_row.current_stage else current_stage end,
    expected_delivery = case when p_values ? 'expected_delivery' then values_row.expected_delivery else expected_delivery end,
    last_status_text = case when p_values ? 'last_status_text' then values_row.last_status_text else last_status_text end,
    last_synced_at = case when p_values ? 'last_synced_at' then values_row.last_synced_at else last_synced_at end,
    sync_status = case when p_values ? 'sync_status' then values_row.sync_status else sync_status end,
    sync_error = case when p_values ? 'sync_error' then values_row.sync_error else sync_error end,
    carrier_data = case when p_values ? 'carrier_data' then values_row.carrier_data else carrier_data end
  where id = p_package_id;
  return true;
end;
$$;

revoke all on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  to service_role;

alter table public.tracking_sync_attempts
  drop constraint tracking_sync_attempts_outcome_check,
  add constraint tracking_sync_attempts_outcome_check check (
    outcome in ('running', 'updated', 'waiting', 'error', 'unsupported', 'abandoned', 'superseded')
  );

notify pgrst, 'reload schema';
