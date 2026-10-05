-- Accept tracking numbers made of letters only and the J&T Cargo carrier.
--
-- A number without a digit is stored when it is six or more letters, the shape of a GLS
-- Track ID. The server applies the narrower limit of the published catalog.
-- The format constraint also accepts the NACEX agency/shipment composite, which
-- create_owned_package has allowed since NACEX was added while this constraint refused it.

alter table public.packages
  drop constraint if exists packages_tracking_number_format_check,
  add constraint packages_tracking_number_format_check check (
    tracking_number ~ '^([A-Z0-9]+|[0-9]{4}/[0-9]{8})$'
    and (tracking_number ~ '[0-9]' or tracking_number ~ '^[A-Z]{6,}$')
  ) not valid;

alter table public.tracking_support_cases
  drop constraint if exists tracking_support_cases_number_check,
  add constraint tracking_support_cases_number_check check (
    length(tracking_number) between 4 and 40
    and (tracking_number ~ '[0-9]' or tracking_number ~ '^[A-Z]{6,}$')
    and tracking_number ~ '^([A-Z0-9]+|[0-9]{4}/[0-9]{8})$'
  );

alter table public.packages
  drop constraint if exists packages_carrier_check,
  add constraint packages_carrier_check
    check (
      carrier in (
        'swiss-post', 'swiss-post-cargo', 'quickpac', 'planzer',
        'aliexpress', 'sunyou', 'hermes', 'spring-gds',
        'postlogistics', 'dachser', 'dhl', 'dhl-ecommerce',
        'ups', 'amazon-logistics', 'amazon-shipping', 'fedex',
        'gls-ch', 'dpd', 'dpd-fr', 'mondial-relay',
        'relais-colis', 'la-poste', 'chronopost', 'gls-fr',
        'colis-prive', 'geodis', 'colisweb', 'c-chez-vous',
        'heppner', 'ciblex', 'paack', 'asendia',
        'shipup', 'india-post', 'hermes-de', 'gls-de',
        'delivengo', 'an-post', 'aramex', 'australia-post',
        'austrian-post', 'blue-dart', 'bpost', 'bring-posten',
        'brt', 'canada-post', 'canpar', 'china-post',
        'correios-br', 'correos-chile', 'correos-express', 'correos-spain',
        'ctt', 'ctt-express', 'delhivery', 'dtdc',
        'ecoscooting', 'ems', 'estafeta', 'evri', 'four-px',
        'gofo', 'hongkong-post', 'inpost', 'j-and-t',
        'japan-post', 'jd-logistics', 'korea-post', 'landmark-global',
        'mrw', 'nacex', 'ninja-van', 'nz-post',
        'old-dominion', 'ontrac', 'packeta', 'parcelforce',
        'poczta-polska', 'pos-malaysia', 'poste-italiane', 'posti',
        'postnord', 'purolator', 'royal-mail', 'seur',
        'sf-express', 'singapore-post', 'spee-dee', 'speedx',
        'sto', 'thailand-post', 'the-courier-guy', 'tipsa',
        'tnt', 'ukrposhta', 'uniuni', 'usps',
        'yamato', 'yanwen', 'yto', 'yunda',
        'yunexpress', 'zto', 'omgo', 'dhl-express',
    'cne', 'dpd-de', 'dpd-uk', 'ekart', 'evri-uk', 'intelcom',
    'lbc-express', 'nova-poshta', 'sagawa', 'speedpak', 'spx-ph', 'xpressbees',
    'j-and-t-cargo',
    'intl-post', 'unknown'
      )
    ) not valid;

alter table public.packages validate constraint packages_carrier_check;

create or replace function public.create_owned_package(
  p_tracking_number text,
  p_label text default '',
  p_carrier text default 'unknown',
  p_tracking_url text default null,
  p_dpd_postcode text default null
)
returns public.packages
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  normalized_tracking text;
  normalized_label text := btrim(coalesce(p_label, ''));
  normalized_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  normalized_postcode text := nullif(btrim(coalesce(p_dpd_postcode, '')), '');
  active_count integer;
  total_count integer;
  created public.packages;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;

  normalized_tracking := upper(regexp_replace(coalesce(p_tracking_number, ''), '[[:space:].-]', '', 'g'));
  if char_length(normalized_tracking) not between 4 and 40
      or (normalized_tracking !~ '^[A-Z0-9]+$' and normalized_tracking !~ '^\d{4}/\d{8}$')
      or (normalized_tracking !~ '[0-9]' and normalized_tracking !~ '^[A-Z]{6,}$') then
    raise exception 'Invalid tracking number' using errcode = '22023';
  end if;
  if char_length(normalized_label) > 80 then
    raise exception 'Parcel names can be at most 80 characters' using errcode = '22023';
  end if;
  if p_carrier is null or p_carrier not in (
    'swiss-post', 'swiss-post-cargo', 'quickpac', 'planzer',
    'aliexpress', 'sunyou', 'hermes', 'spring-gds',
    'postlogistics', 'dachser', 'dhl', 'dhl-ecommerce',
    'ups', 'amazon-logistics', 'amazon-shipping', 'fedex',
    'gls-ch', 'dpd', 'dpd-fr', 'mondial-relay',
    'relais-colis', 'la-poste', 'chronopost', 'gls-fr',
    'colis-prive', 'geodis', 'colisweb', 'c-chez-vous',
    'heppner', 'ciblex', 'paack', 'asendia',
    'shipup', 'india-post', 'hermes-de', 'gls-de',
    'delivengo', 'an-post', 'aramex', 'australia-post',
    'austrian-post', 'blue-dart', 'bpost', 'bring-posten',
    'brt', 'canada-post', 'canpar', 'china-post',
    'correios-br', 'correos-chile', 'correos-express', 'correos-spain',
    'ctt', 'ctt-express', 'delhivery', 'dtdc',
    'ecoscooting', 'ems', 'estafeta', 'evri', 'four-px',
    'gofo', 'hongkong-post', 'inpost', 'j-and-t',
    'japan-post', 'jd-logistics', 'korea-post', 'landmark-global',
    'mrw', 'nacex', 'ninja-van', 'nz-post',
    'old-dominion', 'ontrac', 'packeta', 'parcelforce',
    'poczta-polska', 'pos-malaysia', 'poste-italiane', 'posti',
    'postnord', 'purolator', 'royal-mail', 'seur',
    'sf-express', 'singapore-post', 'spee-dee', 'speedx',
    'sto', 'thailand-post', 'the-courier-guy', 'tipsa',
    'tnt', 'ukrposhta', 'uniuni', 'usps',
    'yamato', 'yanwen', 'yto', 'yunda',
    'yunexpress', 'zto', 'omgo', 'dhl-express',
    'cne', 'dpd-de', 'dpd-uk', 'ekart', 'evri-uk', 'intelcom',
    'lbc-express', 'nova-poshta', 'sagawa', 'speedpak', 'spx-ph', 'xpressbees',
    'j-and-t-cargo',
    'intl-post', 'unknown'
  ) then
    raise exception 'Unsupported carrier' using errcode = '22023';
  end if;
  if p_carrier = 'dachser' and normalized_url is null then
    raise exception 'Dachser requires its complete tracking URL' using errcode = '22023';
  end if;
  if normalized_url is not null and not (
    (
      p_carrier = 'planzer'
      and char_length(normalized_url) <= 4096
      and normalized_url ~ '^https://trackandtrace[.]planzergroup[.]com(?::443)?/shared/sendungen/'
    )
    or (
      p_carrier = 'dachser'
      and char_length(normalized_url) <= 4096
      and normalized_url ~ '^https://customeriberia[.]dachser[.]com(?::443)?/customerarea/utilidades/seguimiento-publico/detalle[?]'
      and normalized_url ~ ('[?&]numeroUnico=' || normalized_tracking || '([&#]|$)')
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

  if p_carrier = 'paack' and normalized_postcode is not null then
    normalized_postcode := upper(normalized_postcode);
    if char_length(normalized_postcode) not between 3 and 10
        or normalized_postcode !~ '[0-9]'
        or normalized_postcode !~ '^[A-Z0-9]+([ -][A-Z0-9]+)*$' then
      raise exception 'Invalid Paack delivery postcode' using errcode = '22023';
    end if;
    normalized_postcode := upper(regexp_replace(normalized_postcode, '[[:space:]]', '', 'g'));
  end if;
  if (p_carrier = 'gls-ch' and coalesce(normalized_postcode, '') !~ '^[0-9]{4}$')
      or (p_carrier = 'dpd' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{4}$')
      or (p_carrier = 'dpd-de' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{5}$')
      or (p_carrier = 'mondial-relay' and coalesce(normalized_postcode, '') !~ '^[0-9]{5}$'
        and not (normalized_postcode is null and public.is_valid_mondial_relay_barcode(normalized_tracking)))
      or (p_carrier in ('heppner', 'gls-de') and coalesce(normalized_postcode, '') !~ '^[0-9]{4,5}$')
      or (
        p_carrier = 'paack'
        and (
          normalized_postcode is null
          or char_length(normalized_postcode) not between 3 and 10
          or normalized_postcode !~ '[0-9]'
          or normalized_postcode !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
        )
      )
      or (
        p_carrier not in ('dpd', 'dpd-de', 'gls-ch', 'gls-de', 'mondial-relay', 'heppner', 'paack')
        and normalized_postcode is not null
      ) then
    raise exception 'Invalid delivery postcode' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select
    count(*) filter (where archived_at is null),
    count(*)
  into active_count, total_count
  from public.packages
  where user_id = actor_id;
  if active_count >= 50 or total_count >= 500 then
    raise exception 'Parcel limit reached' using errcode = 'P0001';
  end if;

  insert into public.packages (
    user_id, tracking_number, label, carrier, tracking_url, dpd_postcode
  ) values (
    actor_id,
    normalized_tracking,
    normalized_label,
    p_carrier,
    normalized_url,
    normalized_postcode
  )
  returning * into created;
  return created;
end;
$$;

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
    'aliexpress', 'sunyou', 'hermes', 'spring-gds',
    'postlogistics', 'dachser', 'dhl', 'dhl-ecommerce',
    'ups', 'amazon-logistics', 'amazon-shipping', 'fedex',
    'gls-ch', 'dpd', 'dpd-fr', 'mondial-relay',
    'relais-colis', 'la-poste', 'chronopost', 'gls-fr',
    'colis-prive', 'geodis', 'colisweb', 'c-chez-vous',
    'heppner', 'ciblex', 'paack', 'asendia',
    'shipup', 'india-post', 'hermes-de', 'gls-de',
    'delivengo', 'an-post', 'aramex', 'australia-post',
    'austrian-post', 'blue-dart', 'bpost', 'bring-posten',
    'brt', 'canada-post', 'canpar', 'china-post',
    'correios-br', 'correos-chile', 'correos-express', 'correos-spain',
    'ctt', 'ctt-express', 'delhivery', 'dtdc',
    'ecoscooting', 'ems', 'estafeta', 'evri', 'four-px',
    'gofo', 'hongkong-post', 'inpost', 'j-and-t',
    'japan-post', 'jd-logistics', 'korea-post', 'landmark-global',
    'mrw', 'nacex', 'ninja-van', 'nz-post',
    'old-dominion', 'ontrac', 'packeta', 'parcelforce',
    'poczta-polska', 'pos-malaysia', 'poste-italiane', 'posti',
    'postnord', 'purolator', 'royal-mail', 'seur',
    'sf-express', 'singapore-post', 'spee-dee', 'speedx',
    'sto', 'thailand-post', 'the-courier-guy', 'tipsa',
    'tnt', 'ukrposhta', 'uniuni', 'usps',
    'yamato', 'yanwen', 'yto', 'yunda',
    'yunexpress', 'zto', 'omgo', 'dhl-express',
    'cne', 'dpd-de', 'dpd-uk', 'ekart', 'evri-uk', 'intelcom',
    'lbc-express', 'nova-poshta', 'sagawa', 'speedpak', 'spx-ph', 'xpressbees',
    'j-and-t-cargo',
    'intl-post', 'unknown'
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
  if (normalized_carrier = 'gls-ch' and coalesce(normalized_postcode, '') !~ '^[0-9]{4}$')
      or (normalized_carrier = 'dpd' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{4}$')
      or (normalized_carrier = 'dpd-de' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{5}$')
      or (normalized_carrier = 'mondial-relay' and coalesce(normalized_postcode, '') !~ '^[0-9]{5}$'
        and not (normalized_postcode is null and public.is_valid_mondial_relay_barcode(tracking_number)))
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
        normalized_carrier not in ('dpd', 'dpd-de', 'gls-ch', 'gls-de', 'mondial-relay', 'heppner', 'paack')
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
          'confirmed_tracking_url', case when carrier = normalized_carrier then normalized_url else tracking_url end,
          'confirmed_postcode', case when carrier = normalized_carrier then normalized_postcode else dpd_postcode end,
          'last_success_at', last_synced_at, 'last_event_at', carrier_data->>'last_update')))
        -- The owner's inputs for the confirmed carrier replace the saved ones.
        when carrier_data->'routing'->>'confirmed_carrier' = normalized_carrier then jsonb_build_object('routing',
          ((carrier_data->'routing') - array['confirmed_tracking_url', 'confirmed_postcode'])
            || jsonb_strip_nulls(jsonb_build_object('confirmed_tracking_url', normalized_url,
              'confirmed_postcode', normalized_postcode)))
        else '{}'::jsonb end
  where id = p_package_id
    and user_id = actor_id;

  return true;
end;
$$;

create or replace function public.create_one_off_parcel(
  p_tracking_number text,
  p_carrier text,
  p_tracking_url text,
  p_dpd_postcode text,
  p_owner_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_tracking text := upper(regexp_replace(coalesce(p_tracking_number, ''), '[[:space:].-]', '', 'g'));
  normalized_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  normalized_postcode text := nullif(btrim(coalesce(p_dpd_postcode, '')), '');
  target_id uuid;
  link_id text;
  created boolean := false;
begin
  if char_length(normalized_tracking) not between 4 and 40
      or (normalized_tracking !~ '^[A-Z0-9]+$' and normalized_tracking !~ '^\d{4}/\d{8}$')
      or (normalized_tracking !~ '[0-9]' and normalized_tracking !~ '^[A-Z]{6,}$')
      or p_carrier is null
      or p_owner_key_hash is null then
    raise exception 'Invalid one-off parcel' using errcode = '22023';
  end if;

  perform private.lock_one_off_number(normalized_tracking);
  select package.id into target_id
  from public.packages as package
  where package.one_off
    and package.user_id is null
    and package.tracking_number = normalized_tracking
    and (package.carrier = p_carrier or package.carrier_data->>'auto_changed_from' = p_carrier)
    and package.tracking_url is not distinct from normalized_url
    and package.dpd_postcode is not distinct from normalized_postcode
  order by package.created_at desc
  limit 1;

  if target_id is null then
    insert into public.packages (user_id, one_off, tracking_number, label, carrier, tracking_url, dpd_postcode)
    values (null, true, normalized_tracking, '', p_carrier, normalized_url, normalized_postcode)
    returning id into target_id;
    created := true;
  end if;

  insert into public.parcel_links (package_id, owner_key_hash)
  values (target_id, p_owner_key_hash)
  returning id into link_id;

  return public.public_parcel(link_id, p_owner_key_hash) || jsonb_build_object('created', created);
end;
$$;

create or replace function public.record_tracking_support_observation(
  p_tracking_number text,
  p_context jsonb,
  p_evidence jsonb,
  p_observed_at timestamptz,
  p_observation_key text
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  number text := upper(regexp_replace(p_tracking_number, '[[:space:].-]', '', 'g'));
  context jsonb := coalesce(p_context, '{}');
  evidence jsonb := coalesce(p_evidence, '{}');
  reason_tags text[];
  candidate_ids text[];
  support_case public.tracking_support_cases;
  observation public.tracking_support_observations;
  inserted_count integer;
  completed boolean;
  provider text;
  source text;
  direct_progress boolean;
begin
  if number is null or length(number) not between 4 and 40 or (number !~ '[0-9]' and number !~ '^[A-Z]{6,}$')
      or number !~ '^([A-Z0-9]+|[0-9]{4}/[0-9]{8})$'
      or p_observed_at is null or not isfinite(p_observed_at)
      or p_observation_key is null or length(p_observation_key) not between 1 and 160
      or jsonb_typeof(context) <> 'object' or octet_length(context::text) > 4096
      or jsonb_typeof(evidence) <> 'object' or octet_length(evidence::text) > 4096 then
    raise exception 'Invalid tracking support observation' using errcode = '22023';
  end if;
  if (context ? 'reasons' and jsonb_typeof(context->'reasons') <> 'array')
      or (context ? 'detection_candidates' and jsonb_typeof(context->'detection_candidates') <> 'array') then
    raise exception 'Invalid tracking support context' using errcode = '22023';
  end if;
  reason_tags := array(
    select distinct tag from (
      select jsonb_array_elements_text(coalesce(context->'reasons', '[]')) as tag
      union all select nullif(evidence->>'support_gap_reason', '')
    ) as supplied where tag is not null order by tag
  );
  candidate_ids := array(select distinct jsonb_array_elements_text(coalesce(context->'detection_candidates', '[]')));
  if cardinality(reason_tags) > 16 or exists(select 1 from unnest(reason_tags) as tag where tag !~ '^[a-z][a-z0-9_]{0,63}$')
      or cardinality(candidate_ids) > 64 or exists(select 1 from unnest(candidate_ids) as id where length(id) not between 1 and 100) then
    raise exception 'Invalid tracking support tags' using errcode = '22023';
  end if;
  completed := nullif(evidence->>'outcome', '') is not null and evidence->>'outcome' <> 'running';
  if completed and evidence->>'outcome' in ('superseded', 'abandoned', 'interrupted') then return null; end if;
  select * into support_case from public.tracking_support_cases where tracking_number = number for update;
  if not found then
    if cardinality(reason_tags) = 0 then return null; end if;
    insert into public.tracking_support_cases(tracking_number, first_seen, last_seen)
    values(number, p_observed_at, p_observed_at) on conflict(tracking_number) do nothing;
    select * into strict support_case from public.tracking_support_cases where tracking_number = number for update;
  end if;
  insert into public.tracking_support_observations(observation_key, case_id, observed_at)
  values(p_observation_key, support_case.id, p_observed_at) on conflict(observation_key) do nothing;
  get diagnostics inserted_count = row_count;
  select * into strict observation from public.tracking_support_observations where observation_key = p_observation_key for update;
  if observation.case_id <> support_case.id then
    raise exception 'Tracking support observation key reused' using errcode = '22023';
  end if;
  if observation.completed then return support_case.id; end if;
  provider := nullif(left(evidence->>'support_provider', 100), '');
  source := nullif(left(evidence->>'source_carrier', 100), '');
  direct_progress := completed and evidence->>'outcome' = 'updated'
    and evidence->>'support_direct_progress' = 'true' and provider is null
    and source is not null and source not in ('unknown', 'intl-post')
    and upper(regexp_replace(evidence->>'support_lookup_number', '[[:space:].-]', '', 'g')) = number;
  update public.tracking_support_cases set
    first_seen = least(first_seen, p_observed_at),
    last_seen = greatest(last_seen, p_observed_at),
    configured_carrier = case when p_observed_at >= last_seen and context ? 'configured_carrier' then nullif(left(context->>'configured_carrier', 100), '') else configured_carrier end,
    detection_carrier = case when p_observed_at >= last_seen and context ? 'detection_carrier' then nullif(left(context->>'detection_carrier', 100), '') else detection_carrier end,
    detection_confidence = case when p_observed_at >= last_seen and context ? 'detection_confidence' then nullif(context->>'detection_confidence', '') else detection_confidence end,
    detection_candidates = case when p_observed_at >= last_seen and context ? 'detection_candidates' then candidate_ids else detection_candidates end,
    app_version = case when p_observed_at >= last_seen and context ? 'app_version' then nullif(left(context->>'app_version', 100), '') else app_version end,
    reasons = array(select distinct tag from unnest(reasons || reason_tags) as tag order by tag),
    seen_count = seen_count + inserted_count,
    fallback_count = fallback_count + case when completed and provider is not null then 1 else 0 end,
    last_provider = case when completed and p_observed_at >= last_seen then provider else last_provider end,
    last_source_carrier = case when completed and p_observed_at >= last_seen then source else last_source_carrier end,
    last_outcome = case when completed and p_observed_at >= last_seen then nullif(left(evidence->>'outcome', 100), '') else last_outcome end,
    last_error_type = case when completed and p_observed_at >= last_seen then nullif(left(evidence->>'error_type', 100), '') else last_error_type end,
    direct_verified_at = case when direct_progress then greatest(direct_verified_at, p_observed_at) else direct_verified_at end,
    direct_verified_carrier = case when direct_progress and (direct_verified_at is null or p_observed_at >= direct_verified_at) then source else direct_verified_carrier end,
    fix_status = case when direct_progress and fix_status = 'fixed' and p_observed_at >= fixed_at then 'verified' else fix_status end
  where id = support_case.id;
  if completed then
    update public.tracking_support_observations set completed = true where observation_key = p_observation_key;
  end if;
  return support_case.id;
end;
$$;
