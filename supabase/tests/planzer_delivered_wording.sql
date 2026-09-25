\set ON_ERROR_STOP on

begin;
set local role service_role;

insert into public.packages (
  id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at
) values
  ('97000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING1', 'quickpac', 'delivered', 'ok', null),
  ('97000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING2', 'planzer', 'delivered', 'ok', null),
  ('97000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING3', 'quickpac', 'delivered', 'ok', now()),
  ('97000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING4', 'quickpac', 'delivered', 'ok', null),
  ('97000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING5', 'quickpac', 'delivered', 'ok', null),
  -- The Quickpac history was kept when the parcel moved to another carrier.
  ('97000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING6', 'swiss-post', 'delivered', 'ok', null),
  ('97000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING7', 'quickpac', 'delivered', 'ok', null),
  ('97000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
   'PLANZERWORDING8', 'quickpac', 'delivered', 'ok', null);

-- Identities are the host's providerEventId() values for these synthetic
-- scans; src/server/quickpacTracking.test.ts pins the first pair.
insert into public.tracking_events (
  id, package_id, stage, description, occurred_at, created_at, provider_event_id, raw_data
) values
  ('97100000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'delivered', 'Shipped',
   '2026-09-01T12:07:10.258Z', '2026-09-01T12:10:00Z',
   'quickpac:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2',
   '{"time":"2026-09-01T14:07:10.258","location":"","description":"Shipped","stage":"delivered","stage_source":"carrier_map"}'),
  -- Same wording without a reproducible identity, or from another provider.
  ('97100000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'delivered', 'Shipped',
   '2026-09-01T12:00:00Z', '2026-09-01T12:10:00Z', 'quickpac:legacy',
   '{"time":"2026-09-01T14:00:00","location":"","description":"Shipped"}'),
  ('97100000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'in_transit', 'Shipped',
   '2026-08-31T08:00:00Z', '2026-09-01T12:10:00Z',
   'swiss-post:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2',
   '{"time":"2026-09-01T14:07:10.258","location":"","description":"Shipped"}'),
  ('97100000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001', 'out_for_delivery', 'In delivery',
   '2026-09-01T04:05:03.811Z', '2026-09-01T12:10:00Z', 'quickpac:in-delivery',
   '{"time":"2026-09-01T06:05:03.8117395","location":"","description":"In delivery"}'),
  ('97100000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000002', 'delivered', 'Shipped',
   '2026-09-02T13:00:00.5Z', '2026-09-02T13:10:00Z',
   'planzer:0bdbf4f3a0440f0cc9c46e8f8eb4a01b0f4cee0d49463dd5c25e0203c508a891',
   '{"time":"2026-09-02T15:00:00.5","location":"","description":"Shipped","stage":"delivered","stage_source":"carrier_map"}'),
  -- Older rows kept only the scan's time, location and wording.
  ('97100000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000003', 'delivered', 'Shipped',
   '2026-08-20T08:00:00Z', '2026-08-20T08:10:00Z',
   'quickpac:3b09415a09d672958dff6b95b86393f508f0f3cdb3fbc65cb6cb606c8a41be76',
   '{"time":"2026-08-20T10:00:00","location":"","description":"Shipped"}'),
  -- A refresh saved the milestone again under its new identity.
  ('97100000-0000-0000-0000-000000000007', '97000000-0000-0000-0000-000000000004', 'delivered', 'Shipped',
   '2026-09-03T10:00:00Z', '2026-09-03T10:10:00Z',
   'quickpac:945e27d4c285bc8f843b47b4e67d9ec9873291ba59e66b1a98992a87e5a739b7',
   '{"time":"2026-09-03T12:00:00","location":"","description":"Shipped","stage":"delivered","stage_source":"carrier_map"}'),
  ('97100000-0000-0000-0000-000000000008', '97000000-0000-0000-0000-000000000004', 'delivered', 'Delivered',
   '2026-09-03T10:00:00Z', '2026-09-25T09:00:00Z',
   'quickpac:a9b89ef2b84c769198904eb8c85d298ecdccd71ea3b12c792150702f59b495e5',
   '{"time":"2026-09-03T12:00:00","location":"","description":"Delivered","stage":"delivered","stage_source":"carrier_map"}'),
  -- The reverse: an older build saved "Shipped" again after the relabel.
  ('97100000-0000-0000-0000-000000000009', '97000000-0000-0000-0000-000000000005', 'delivered', 'Delivered',
   '2026-09-04T10:00:00Z', '2026-09-04T10:10:00Z',
   'quickpac:34cac602851bb1c72b55096c0bd686e89a6740766c5b0d703310e09979605183',
   '{"time":"2026-09-04T12:00:00","location":"","description":"Delivered","stage":"delivered","stage_source":"carrier_map"}'),
  ('97100000-0000-0000-0000-000000000010', '97000000-0000-0000-0000-000000000005', 'delivered', 'Shipped',
   '2026-09-04T10:00:00Z', '2026-09-25T09:00:00Z',
   'quickpac:cb6a18a0335cd2dd09e57f4123eaab6d09f5ceb2e4dcf1b6c7db9f164aef4557',
   '{"time":"2026-09-04T12:00:00","location":"","description":"Shipped","stage":"delivered","stage_source":"carrier_map"}'),
  ('97100000-0000-0000-0000-000000000011', '97000000-0000-0000-0000-000000000006', 'delivered', 'Shipped',
   '2026-09-01T12:07:10.258Z', '2026-09-01T12:10:00Z',
   'quickpac:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2',
   '{"time":"2026-09-01T14:07:10.258","location":"","description":"Shipped"}'),
  -- A reproducible identity alone is not enough: stage and raw wording must agree.
  ('97100000-0000-0000-0000-000000000012', '97000000-0000-0000-0000-000000000007', 'in_transit', 'Shipped',
   '2026-09-01T12:07:10.258Z', '2026-09-01T12:10:00Z',
   'quickpac:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2',
   '{"time":"2026-09-01T14:07:10.258","location":"","description":"Shipped"}'),
  ('97100000-0000-0000-0000-000000000013', '97000000-0000-0000-0000-000000000008', 'delivered', 'Shipped',
   '2026-09-01T12:07:10.258Z', '2026-09-01T12:10:00Z',
   'quickpac:e4db6ac35959c7a682393acf8c1cd1dca04dcf11c375921ecd1fbb1d223bb8f2',
   '{"time":"2026-09-01T14:07:10.258","location":"","description":"Zugestellt"}');

create temporary table expected_relabels (id uuid primary key, provider_event_id text);
insert into expected_relabels values
  ('97100000-0000-0000-0000-000000000001', 'quickpac:b37df0b80f5390316ccd97ea0dd53dc7660d87429f4cb6c62a6b563f5b5fd7b1'),
  ('97100000-0000-0000-0000-000000000005', 'planzer:23bffeb5f5ad87b5c564616cbe07ce7c3c445a45de8032ff66a12d65d82cf654'),
  ('97100000-0000-0000-0000-000000000006', 'quickpac:2069b4669bc1c9e8f63b3d29ba77bb0cc648939477b86322a37ee79f0414e9bf'),
  ('97100000-0000-0000-0000-000000000007', 'quickpac:a9b89ef2b84c769198904eb8c85d298ecdccd71ea3b12c792150702f59b495e5'),
  ('97100000-0000-0000-0000-000000000011', 'quickpac:b37df0b80f5390316ccd97ea0dd53dc7660d87429f4cb6c62a6b563f5b5fd7b1');
create temporary table expected_deletions (id uuid primary key);
insert into expected_deletions values
  ('97100000-0000-0000-0000-000000000008'),
  ('97100000-0000-0000-0000-000000000010');

create temporary table packages_before_planzer_wording as select * from public.packages;
create temporary table events_before_planzer_wording as select * from public.tracking_events;

\ir ../migrations/20260925100000_relabel_planzer_delivered_events.sql

do $$
begin
  if (
    select count(*) from public.tracking_events as event
    join expected_relabels as expected on expected.id = event.id
    join events_before_planzer_wording as original on original.id = event.id
    where event.description = 'Delivered'
      and event.provider_event_id = expected.provider_event_id
      and event.raw_data = jsonb_set(original.raw_data, '{description}', '"Delivered"')
      and (to_jsonb(event) - 'description' - 'provider_event_id' - 'raw_data')
        = (to_jsonb(original) - 'description' - 'provider_event_id' - 'raw_data')
  ) <> 5 then
    raise exception 'Saved Planzer "Shipped" rows were not moved to the host''s "Delivered" identity';
  end if;

  if exists (
    select 1 from public.tracking_events as event
    join expected_deletions as deleted on deleted.id = event.id
  ) then
    raise exception 'The newer duplicate of a relabeled milestone was kept';
  end if;

  if exists (
    select 1 from public.tracking_events as event
    full join events_before_planzer_wording as original on original.id = event.id
    where coalesce(event.id, original.id) not in (select id from expected_relabels)
      and coalesce(event.id, original.id) not in (select id from expected_deletions)
      and to_jsonb(event) is distinct from to_jsonb(original)
  ) then
    raise exception 'Planzer relabel changed unrelated or insufficiently evidenced events';
  end if;

  if exists (
    select 1 from public.packages as package
    full join packages_before_planzer_wording as original on original.id = package.id
    where to_jsonb(package) is distinct from to_jsonb(original)
  ) then
    raise exception 'Planzer relabel changed package state';
  end if;
end;
$$;

create temporary table events_after_planzer_wording as
select id, ctid as row_location, to_jsonb(event) as value from public.tracking_events as event;

\ir ../migrations/20260925100000_relabel_planzer_delivered_events.sql

do $$
begin
  if exists (
    select 1 from public.tracking_events as event
    full join events_after_planzer_wording as original on original.id = event.id
    where to_jsonb(event) is distinct from original.value
      or event.ctid is distinct from original.row_location
  ) then
    raise exception 'Planzer relabel is not idempotent';
  end if;
end;
$$;

rollback;
select 'Planzer delivered wording relabel assertions passed' as result;
