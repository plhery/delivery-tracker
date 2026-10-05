\set ON_ERROR_STOP on

insert into public.packages(id, user_id, tracking_number, label, carrier, current_stage, sync_status, carrier_data)
select ('19100000-0000-0000-0000-' || lpad(sample.id::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  (123450030 + sample.id)::text || ((123450030 + sample.id) % 7)::text,
  'Provider identity fixture', case when sample.id = 2 then 'ups' else 'unknown' end,
  'delivered', 'ok', jsonb_build_object(
    'tracking_provider', 'Ship24', 'discovered_carrier', 'dhl-express',
    'reported_carriers', case when sample.id = 3 then '["DHL Express","Swiss Post"]'::jsonb else '["DHL Express"]'::jsonb end,
    'routing', jsonb_build_object('configured_carrier', case when sample.id = 2 then 'ups' else 'unknown' end,
      'preferred_provider', 'Ship24',
      'preferred_number', case when sample.id = 4 then 'OTHER1234'
        else (123450030 + sample.id)::text || ((123450030 + sample.id) % 7)::text end,
      'last_event_at', now() - interval '1 hour'))
from generate_series(1, 5) as sample(id);

insert into public.tracking_events(package_id, stage, description, occurred_at, provider_event_id)
select ('19100000-0000-0000-0000-' || lpad(sample.id::text, 12, '0'))::uuid,
  'delivered', 'Delivered', now() - interval '1 hour', 'unknown:provider-fixture'
from generate_series(1, 4) as sample(id);
