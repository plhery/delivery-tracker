\set ON_ERROR_STOP on

-- Links as the server before sharing left them: a lookup, and two lookups kept
-- by one account whose parcels were merged since, so both point at one parcel.
insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-000000000001', 'before-sharing@example.test');
insert into public.packages (id, user_id, tracking_number, carrier) values
  ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'PRESHARE0001', 'unknown');
insert into public.packages (id, user_id, one_off, tracking_number, carrier) values
  ('d0000000-0000-4000-8000-000000000003', null, true, 'PRESHARE0002', 'unknown');
insert into public.parcel_links (id, package_id, created_by, show_number, created_at) values
  ('preShareLnk2', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', true, now() - interval '2 days'),
  ('preShareLnk3', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', false, now() - interval '1 day');
insert into public.parcel_links (id, package_id, owner_key_hash) values
  ('preShareLnk4', 'd0000000-0000-4000-8000-000000000003', repeat('c', 64));
