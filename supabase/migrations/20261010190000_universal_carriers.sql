-- Accept fifty European and North American carriers that universal providers track.

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
    'dhl-ecommerce-es', 'dhl-ecommerce-nl', 'dhl-ecommerce-pl', 'dhl-ecommerce-uk',
    'dpd-pl', 'emile', 'gofo-fr', 'gofo-it',
    'abf-freight', 'acs-courier', 'allegro-one', 'apc-overnight', 'aras-kargo',
    'box-now', 'cdek', 'ceska-posta', 'chit-chats', 'correos-de-mexico',
    'cyprus-post', 'day-ross', 'dsv', 'dx', 'dynalogic', 'envialia',
    'epost-global', 'estes', 'fan-courier', 'gebrueder-weiss',
    'geniki-taxydromiki', 'gls-es', 'gls-it', 'jitsu', 'kuehne-nagel',
    'latvijas-pasts', 'loomis-express', 'lso', 'magyar-posta', 'meest',
    'mng-kargo', 'nationex', 'post-luxembourg', 'posta-slovenije',
    'posta-srbije', 'ptt', 'redpack', 'rl-carriers', 'russian-post', 'saia',
    'sameday', 'speedy', 'trans-o-flex', 'ubi-smart-parcel', 'wanbexpress',
    'whistl', 'xdp', 'xpo-ltl', 'yurtici-kargo', 'zeleris',
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
    'dhl-ecommerce-es', 'dhl-ecommerce-nl', 'dhl-ecommerce-pl', 'dhl-ecommerce-uk',
    'dpd-pl', 'emile', 'gofo-fr', 'gofo-it',
    'abf-freight', 'acs-courier', 'allegro-one', 'apc-overnight', 'aras-kargo',
    'box-now', 'cdek', 'ceska-posta', 'chit-chats', 'correos-de-mexico',
    'cyprus-post', 'day-ross', 'dsv', 'dx', 'dynalogic', 'envialia',
    'epost-global', 'estes', 'fan-courier', 'gebrueder-weiss',
    'geniki-taxydromiki', 'gls-es', 'gls-it', 'jitsu', 'kuehne-nagel',
    'latvijas-pasts', 'loomis-express', 'lso', 'magyar-posta', 'meest',
    'mng-kargo', 'nationex', 'post-luxembourg', 'posta-slovenije',
    'posta-srbije', 'ptt', 'redpack', 'rl-carriers', 'russian-post', 'saia',
    'sameday', 'speedy', 'trans-o-flex', 'ubi-smart-parcel', 'wanbexpress',
    'whistl', 'xdp', 'xpo-ltl', 'yurtici-kargo', 'zeleris',
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
  if p_carrier in ('dpd', 'gls-de', 'mondial-relay') and normalized_postcode is not null then
    normalized_postcode := upper(regexp_replace(normalized_postcode, '[[:space:]]+', ' ', 'g'));
  end if;
  if (p_carrier = 'gls-ch' and coalesce(normalized_postcode, '') !~ '^[0-9]{4}$')
      or (
        p_carrier in ('dpd', 'gls-de', 'mondial-relay')
        and normalized_postcode is not null
        and (
          char_length(normalized_postcode) not between 3 and 12
          or normalized_postcode !~ '[0-9]'
          or normalized_postcode !~ '^[A-Z0-9]+([ -][A-Z0-9]+)*$'
        )
      )
      or (p_carrier = 'dpd-de' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{5}$')
      or (p_carrier = 'mondial-relay' and normalized_postcode is null and (
        normalized_tracking ~ '^[0-9]{8}$'
        or (normalized_tracking ~ '^[0-9]{26}$' and not public.is_valid_mondial_relay_barcode(normalized_tracking))
      ))
      or (p_carrier = 'gls-de' and normalized_postcode is null)
      or (p_carrier = 'heppner' and coalesce(normalized_postcode, '') !~ '^[0-9]{4,5}$')
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
    'dhl-ecommerce-es', 'dhl-ecommerce-nl', 'dhl-ecommerce-pl', 'dhl-ecommerce-uk',
    'dpd-pl', 'emile', 'gofo-fr', 'gofo-it',
    'abf-freight', 'acs-courier', 'allegro-one', 'apc-overnight', 'aras-kargo',
    'box-now', 'cdek', 'ceska-posta', 'chit-chats', 'correos-de-mexico',
    'cyprus-post', 'day-ross', 'dsv', 'dx', 'dynalogic', 'envialia',
    'epost-global', 'estes', 'fan-courier', 'gebrueder-weiss',
    'geniki-taxydromiki', 'gls-es', 'gls-it', 'jitsu', 'kuehne-nagel',
    'latvijas-pasts', 'loomis-express', 'lso', 'magyar-posta', 'meest',
    'mng-kargo', 'nationex', 'post-luxembourg', 'posta-slovenije',
    'posta-srbije', 'ptt', 'redpack', 'rl-carriers', 'russian-post', 'saia',
    'sameday', 'speedy', 'trans-o-flex', 'ubi-smart-parcel', 'wanbexpress',
    'whistl', 'xdp', 'xpo-ltl', 'yurtici-kargo', 'zeleris',
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
  if normalized_carrier in ('dpd', 'gls-de', 'mondial-relay') and normalized_postcode is not null then
    normalized_postcode := upper(regexp_replace(normalized_postcode, '[[:space:]]+', ' ', 'g'));
  end if;
  if (normalized_carrier = 'gls-ch' and coalesce(normalized_postcode, '') !~ '^[0-9]{4}$')
      or (
        normalized_carrier in ('dpd', 'gls-de', 'mondial-relay')
        and normalized_postcode is not null
        and (
          char_length(normalized_postcode) not between 3 and 12
          or normalized_postcode !~ '[0-9]'
          or normalized_postcode !~ '^[A-Z0-9]+([ -][A-Z0-9]+)*$'
        )
      )
      or (normalized_carrier = 'dpd-de' and normalized_postcode is not null and normalized_postcode !~ '^[0-9]{5}$')
      or (normalized_carrier = 'mondial-relay' and normalized_postcode is null and (
        tracking_number ~ '^[0-9]{8}$'
        or (tracking_number ~ '^[0-9]{26}$' and not public.is_valid_mondial_relay_barcode(tracking_number))
      ))
      or (normalized_carrier = 'gls-de' and normalized_postcode is null)
      or (normalized_carrier = 'heppner' and coalesce(normalized_postcode, '') !~ '^[0-9]{4,5}$')
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

insert into public.applied_migrations (name) values ('20261010190000_universal_carriers') on conflict do nothing;
