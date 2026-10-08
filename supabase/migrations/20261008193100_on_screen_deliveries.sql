-- Two-minute checks only for the parcels out for delivery someone has on
-- screen.
--
-- A parcel out for delivery is on screen while its account's apps read its
-- parcels lately, one of its links was opened lately, or a Live Activity
-- shows it. A scheduled sync asks which parcels out for delivery are, checks
-- them every two minutes by day, and checks the others as often as a parcel
-- at any other stage. The apps and link pages record a read at most every
-- five minutes, so the server asks with a ten-minute window.
--
-- Apply this before deploying the server that uses it. The server before it
-- keeps working on this schema: it does not call the function.

begin;

create function public.viewed_delivery_ids(p_viewed_since timestamptz)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select package.id
  from public.packages as package
  where package.current_stage = 'out_for_delivery'
    and package.archived_at is null
    and (
      exists (
        select 1 from public.account_activity as activity
        where activity.user_id = package.user_id and activity.last_opened_at > p_viewed_since
      )
      or exists (
        select 1 from public.parcel_links as link
        where link.package_id = package.id and link.last_opened_at > p_viewed_since
      )
      or exists (
        select 1
        from public.live_activity_update_tokens as activity_token
        join public.live_activity_devices as device on device.id = activity_token.device_id
        where activity_token.package_id = package.id and device.disabled_at is null
      )
    );
$$;

revoke all on function public.viewed_delivery_ids(timestamptz) from public, anon, authenticated;
grant execute on function public.viewed_delivery_ids(timestamptz) to service_role;

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008193100_on_screen_deliveries') on conflict do nothing;

commit;
