-- The wording DPD Switzerland's map leaves unmapped on purpose was seeded here by
-- 20261008050000_review_queue_replays.sql. The scraper now declares every such gap
-- in its carriers' status maps, with the same notes, and the server closes the
-- observations they cover as each sync records them and once per server version
-- (src/server/reviewQueues.ts). This table keeps the gaps declared by hand.
--
-- Only the seeded rows, still as seeded, are removed. Removing them reopens
-- nothing: the trigger closes on insert and update only.
delete from public.tracking_status_intentionally_unmapped as intended
using (values
  ('dpd', 'PARCEL_HANDED', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'IN_TRANSIT', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'AT_DELIVERY_CENTER', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'ORI', null, 'DPD''s map leaves it unmapped on purpose, like its twin PARCEL_HANDED, so an import that cleared customs does not step back to accepted.'),
  ('dpd', null, 'parcel handed to dpd', 'The label of PARCEL_HANDED, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'your parcel is on its way', 'The label of IN_TRANSIT, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'at delivery center', 'The label of AT_DELIVERY_CENTER, which DPD''s map leaves unmapped on purpose.')
) as seeded (carrier, provider_code, description_normalized, note)
where intended.carrier = seeded.carrier
  and intended.provider_code is not distinct from seeded.provider_code
  and intended.description_normalized is not distinct from seeded.description_normalized
  and intended.note = seeded.note;

insert into public.applied_migrations (name) values ('20261008210000_scraper_status_gaps') on conflict do nothing;
