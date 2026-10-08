-- Parcels out for delivery no longer follow who has them on screen. The
-- server checks the ones their carrier's own adapter answers for every two
-- minutes by day, and the ones a universal provider answers for at the
-- regular cadence, so nothing asks viewed_delivery_ids any more.
--
-- The reads it looked at stay: the apps, the link pages and Live Activities
-- still record them, and unwatched_package_ids still uses them.
--
-- Apply it once a server that no longer asks is running: an older one
-- reports list_viewed_deliveries to Sentry on every scheduled sync, and
-- checks every parcel out for delivery every two minutes.

begin;

drop function public.viewed_delivery_ids(timestamptz);

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008230000_drop_on_screen_deliveries') on conflict do nothing;

commit;
