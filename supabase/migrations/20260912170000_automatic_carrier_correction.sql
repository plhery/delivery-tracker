-- Atomically save verified carrier corrections with their tracking evidence.
create or replace function public.apply_tracking_sync(
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
  current_row public.packages;
begin
  select * into current_row from public.packages
  where id = p_package_id and tracking_generation = p_tracking_generation
  for update;
  if not found then return false; end if;

  if jsonb_typeof(p_values) is distinct from 'object'
      or jsonb_typeof(p_events) is distinct from 'array'
      or (p_values - array[
        'current_stage', 'expected_delivery', 'last_status_text', 'last_synced_at',
        'sync_status', 'sync_error', 'carrier_data', 'carrier', 'tracking_url', 'dpd_postcode'
      ]) <> '{}'::jsonb then
    raise exception 'Invalid tracking sync payload' using errcode = '22023';
  end if;
  -- Only a direct scraper confirmation for this exact number may correct selection.
  if p_values ?| array['carrier', 'tracking_url', 'dpd_postcode'] then
    if not (p_values ?& array['carrier', 'tracking_url', 'dpd_postcode', 'carrier_data'])
      or p_values->>'carrier' is null
      or p_values->>'carrier' = current_row.carrier
      or p_values#>>'{carrier_data,routing,confirmed_carrier}' is distinct from p_values->>'carrier'
      or p_values#>>'{carrier_data,routing,configured_carrier}' is distinct from p_values->>'carrier'
      or p_values#>>'{carrier_data,routing,confirmed_number}' is distinct from current_row.tracking_number
      or p_values#>>'{carrier_data,auto_changed_from}' is distinct from current_row.carrier
      or p_values#>>'{carrier_data,auto_changed_to}' is distinct from p_values->>'carrier'
      or current_row.carrier_data->>'original_carrier' is not null then
      raise exception 'Invalid automatic carrier correction' using errcode = '22023';
    end if;
    p_values := jsonb_set(p_values, '{carrier_data,auto_changed_at}', to_jsonb(now()));
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
  -- Keep ordinary status writes from firing the input-generation trigger.
  if p_values ? 'carrier' then
    update public.packages set carrier = values_row.carrier,
      tracking_url = values_row.tracking_url, dpd_postcode = values_row.dpd_postcode
    where id = p_package_id;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  to service_role;


-- Keep previous evidence when a user tries another carrier for the same number.
-- Ownership, input validation, job cancellation and generation fencing are preserved.
create or replace function public.change_owned_package_carrier(
  p_package_id uuid,
  p_carrier text,
  p_tracking_url text default null,
  p_dpd_postcode text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  tracking_number text;
  normalized_carrier text := p_carrier;
  normalized_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  normalized_postcode text := nullif(btrim(coalesce(p_dpd_postcode, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select package.tracking_number
  into tracking_number
  from public.packages as package
  where package.id = p_package_id
    and package.user_id = actor_id
  for update;

  if not found then return false; end if;

  if tracking_number ~ '^44[0-9]{16}$' then normalized_carrier := 'quickpac'; end if;
  if normalized_carrier is null or normalized_carrier not in (
    'swiss-post', 'swiss-post-cargo', 'quickpac', 'planzer',
    'aliexpress', 'sunyou', 'hermes', 'spring-gds', 'postlogistics',
    'dachser', 'dhl', 'dhl-ecommerce', 'ups', 'amazon-logistics', 'fedex', 'gls-ch',
    'dpd', 'dpd-fr', 'mondial-relay', 'relais-colis', 'la-poste',
    'chronopost', 'gls-fr', 'colis-prive', 'geodis', 'colisweb',
    'c-chez-vous', 'heppner', 'ciblex', 'paack', 'asendia',
    'shipup', 'india-post', 'hermes-de', 'gls-de', 'delivengo', 'intl-post', 'unknown'
  ) then
    raise exception 'Unsupported carrier' using errcode = '22023';
  end if;

  if normalized_carrier = 'dachser' and normalized_url is null then
    raise exception 'Dachser requires its complete tracking URL' using errcode = '22023';
  end if;
  if normalized_url is not null and not (
    (
      normalized_carrier = 'planzer'
      and char_length(normalized_url) <= 4096
      and normalized_url ~ '^https://trackandtrace[.]planzergroup[.]com(?::443)?/shared/sendungen/'
    )
    or (
      normalized_carrier = 'dachser'
      and char_length(normalized_url) <= 4096
      and normalized_url ~ '^https://customeriberia[.]dachser[.]com(?::443)?/customerarea/utilidades/seguimiento-publico/detalle[?]'
      and normalized_url ~ ('[?&]numeroUnico=' || tracking_number || '([&#]|$)')
      and (
        normalized_url ~ '[?&]hash=[A-Za-z0-9_-]{4,255}[A-Za-z0-9_-]?([&#]|$)'
        or (
          normalized_url ~ '[?&]clave=[A-Za-z0-9_-]{4,255}[A-Za-z0-9_-]?([&#]|$)'
          and normalized_url ~ '[?&]fecha=[0-9]{8}([&#]|$)'
        )
      )
    )
  ) then
    raise exception 'Invalid tracking URL' using errcode = '22023';
  end if;

  if normalized_carrier = 'paack' and normalized_postcode is not null then
    normalized_postcode := upper(normalized_postcode);
    if char_length(normalized_postcode) not between 3 and 10
        or normalized_postcode !~ '[0-9]'
        or normalized_postcode !~ '^[A-Z0-9]+([ -][A-Z0-9]+)*$' then
      raise exception 'Invalid Paack delivery postcode' using errcode = '22023';
    end if;
    normalized_postcode := upper(regexp_replace(normalized_postcode, '[[:space:]]', '', 'g'));
  end if;
  if (normalized_carrier in ('dpd', 'gls-ch') and coalesce(normalized_postcode, '') !~ '^[0-9]{4}$')
      or (normalized_carrier = 'mondial-relay' and coalesce(normalized_postcode, '') !~ '^[0-9]{5}$')
      or (normalized_carrier in ('heppner', 'gls-de') and coalesce(normalized_postcode, '') !~ '^[0-9]{4,5}$')
      or (
        normalized_carrier = 'paack'
        and (
          normalized_postcode is null
          or char_length(normalized_postcode) not between 3 and 10
          or normalized_postcode !~ '[0-9]'
          or normalized_postcode !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
        )
      )
      or (
        normalized_carrier not in ('dpd', 'gls-ch', 'gls-de', 'mondial-relay', 'heppner', 'paack')
        and normalized_postcode is not null
      ) then
    raise exception 'Invalid delivery postcode' using errcode = '22023';
  end if;

  update public.sync_jobs
  set
    state = 'failed',
    completed_at = now(),
    lease_until = null,
    locked_by = null,
    dedupe_key = null,
    last_error = 'Superseded because the package carrier changed.'
  where package_id = p_package_id
    and state in ('queued', 'running');


  update public.packages
  set
    carrier = normalized_carrier,
    tracking_url = normalized_url,
    dpd_postcode = normalized_postcode,
    last_synced_at = null,
    sync_status = 'pending',
    sync_error = null,
    carrier_data = (carrier_data - array['active_tracking_carrier', 'active_tracking_number', 'swiss_post_ready', 'auto_changed_from', 'auto_changed_to', 'auto_changed_at'])
      || case when not (carrier_data ? 'routing') and sync_status = 'ok' then jsonb_build_object('routing',
        jsonb_strip_nulls(jsonb_build_object('version', 1, 'configured_carrier', carrier,
          'confirmed_carrier', carrier, 'confirmed_number', packages.tracking_number,
          'confirmed_tracking_url', tracking_url, 'confirmed_postcode', dpd_postcode,
          'last_success_at', last_synced_at, 'last_event_at', carrier_data->>'last_update')))
        else '{}'::jsonb end
  where id = p_package_id
    and user_id = actor_id;

  return true;
end;
$$;

revoke all on function public.change_owned_package_carrier(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.change_owned_package_carrier(uuid, text, text, text)
  to authenticated;

comment on function public.change_owned_package_carrier(uuid, text, text, text) is
  'Changes carrier selection, fences stale workers, and preserves verified history and recovery routing.';

notify pgrst, 'reload schema';
