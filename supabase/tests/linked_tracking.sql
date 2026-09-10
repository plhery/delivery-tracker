\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000002', 'link-test@example.test') on conflict (id) do nothing;
set local role service_role;
insert into public.packages (id, user_id, tracking_number, label, carrier, current_stage, sync_status, carrier_data)
values
 ('81000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LINKORIGINAL1', 'Perfume', 'gls-de', 'in_transit', 'ok', '{"sender_name":"Example sender"}'),
 ('81000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'LINKDELIVERY1', 'Surprise', 'swiss-post', 'out_for_delivery', 'ok', '{}'),
 ('81000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'LINKOTHERUSER1', 'Private parcel', 'swiss-post', 'in_transit', 'ok', '{}');
update public.packages set expected_delivery = '2026-09-10' where tracking_number = 'LINKDELIVERY1';
insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at) values
 ('81000000-0000-0000-0000-000000000001', 'gls-de:early', 'accepted', 'GLS accepted', '2026-09-08T10:00:00Z'),
 ('81000000-0000-0000-0000-000000000001', 'shared-event', 'in_transit', 'Earlier copy', '2026-09-09T10:00:00Z'),
 ('81000000-0000-0000-0000-000000000002', 'shared-event', 'in_transit', 'Delivery copy', '2026-09-09T10:00:00Z'),
 ('81000000-0000-0000-0000-000000000002', 'swiss-post:latest', 'out_for_delivery', 'On vehicle', '2026-09-10T07:00:00Z');

do $$
declare
  linked public.packages;
  old_generation uuid;
begin
  if has_function_privilege('authenticated', 'public.link_package_tracking(uuid,uuid)', 'execute') then
    raise exception 'Linking must be service-only';
  end if;
  begin
    perform public.link_package_tracking('81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003');
    raise exception 'Cross-account link was accepted';
  exception when invalid_parameter_value then null;
  end;
  select tracking_generation into old_generation from public.packages where tracking_number = 'LINKDELIVERY1';
  perform public.link_package_tracking('81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002');
  select * into linked from public.packages where tracking_number = 'LINKDELIVERY1';
  if linked.label <> 'Perfume / Surprise' or linked.carrier <> 'swiss-post'
     or linked.current_stage <> 'out_for_delivery' or linked.expected_delivery <> '2026-09-10'
     or linked.carrier_data->>'original_carrier' <> 'gls-de'
     or linked.carrier_data->>'original_tracking_number' <> 'LINKORIGINAL1'
     or linked.carrier_data->>'sender_name' <> 'Example sender'
     or linked.tracking_generation = old_generation then
    raise exception 'Linked parcel lost identity, name, progress, ETA or generation fencing';
  end if;
  if exists (select 1 from public.packages where tracking_number = 'LINKORIGINAL1') then
    raise exception 'Duplicate parcel remains';
  end if;
  if (select count(*) from public.tracking_events where package_id = linked.id and provider_event_id <> 'app:pending') <> 3 then
    raise exception 'History was lost or duplicated';
  end if;
  if not exists (select 1 from public.tracking_events where package_id = linked.id and description = 'Delivery copy') then
    raise exception 'Delivery event must win when both trackers supplied it';
  end if;
  if public.apply_tracking_sync(linked.id, old_generation, '{"carrier_data":{}}') then
    raise exception 'Stale worker overwrote linked metadata';
  end if;
  perform public.link_package_tracking('81000000-0000-0000-0000-000000000001', linked.id);
  if (select label from public.packages where id = linked.id) <> 'Perfume / Surprise' then
    raise exception 'Retry must not concatenate names again';
  end if;
end;
$$;
rollback;
