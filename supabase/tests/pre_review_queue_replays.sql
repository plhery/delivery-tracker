\set ON_ERROR_STOP on

-- Open DPD wording from before the deliberate gaps were recorded, and one
-- reviewed by hand. review_queue_replays.sql checks and removes them.
insert into public.tracking_status_observations
  (observation_key, carrier, provider_code, description_normalized, stage_source, chosen_stage, reviewed_at, resolution)
values
  (repeat('e', 64), 'dpd', 'PARCEL_HANDED', 'parcel handed to dpd', 'none', 'in_transit', null, null),
  (repeat('f', 64), 'dpd', null, 'your parcel is on its way', 'none', 'in_transit', null, null),
  (repeat('9', 64), 'dpd', 'SPL', 'synthetic split wording', 'none', 'in_transit', null, null),
  (repeat('8', 64), 'dpd', null, 'parcel out for delivery', 'none', 'out_for_delivery', null, null),
  (repeat('7', 64), 'dpd', 'IN_TRANSIT', 'your parcel is on its way', 'none', 'in_transit', now(), 'mapped');
