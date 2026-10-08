\set ON_ERROR_STOP on
begin;

do $$
begin
  assert not exists (select 1 from public.tracking_status_intentionally_unmapped where carrier = 'dpd'),
    'The seeded DPD gaps remain after the migrations';
end $$;

-- The seed as 20261008050000 wrote it, except one row edited by hand, and a gap
-- declared by hand for another carrier. Each closes the open wording it covers.
insert into public.tracking_status_observations
  (observation_key, carrier, provider_code, description_normalized, stage_source, chosen_stage)
values
  (repeat('a', 64), 'dpd', 'PARCEL_HANDED', 'synthetic handover', 'none', 'in_transit'),
  (repeat('b', 64), 'dpd', null, 'your parcel is on its way', 'none', 'in_transit');
insert into public.tracking_status_intentionally_unmapped (carrier, provider_code, description_normalized, note) values
  ('dpd', 'PARCEL_HANDED', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'IN_TRANSIT', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'AT_DELIVERY_CENTER', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'ORI', null, 'Synthetic note edited by hand.'),
  ('dpd', null, 'parcel handed to dpd', 'The label of PARCEL_HANDED, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'your parcel is on its way', 'The label of IN_TRANSIT, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'at delivery center', 'The label of AT_DELIVERY_CENTER, which DPD''s map leaves unmapped on purpose.'),
  ('ctt', '42', null, 'Synthetic gap declared by hand.');

\ir ../migrations/20261008210000_scraper_status_gaps.sql

do $$
begin
  assert (select array_agg(carrier || '/' || coalesce(provider_code, '') order by carrier)
    from public.tracking_status_intentionally_unmapped) = array['ctt/42', 'dpd/ORI'],
    'The migration removed a gap declared or edited by hand, or kept a seeded one';
  assert (select count(*) = 2 from public.tracking_status_observations
    where observation_key in (repeat('a', 64), repeat('b', 64))
      and resolution = 'ignored' and reviewed_at is not null), 'Removing a gap reopened its wording';
end $$;

\ir ../migrations/20261008210000_scraper_status_gaps.sql

do $$
begin
  assert (select count(*) = 2 from public.tracking_status_intentionally_unmapped), 'The migration is not idempotent';
end $$;
rollback;
