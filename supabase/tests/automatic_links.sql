\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000002', 'auto-link-test@example.test') on conflict (id) do nothing;
set local role service_role;
insert into packages (id,user_id,tracking_number,label,carrier,current_stage,sync_status,carrier_data) values
 ('82000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','123456789011','Perfume','gls-de','in_transit','ok','{}'),
 ('82000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','990000000000000002','Surprise','swiss-post','in_transit','ok','{"international_tracking_number":"12345678901"}'),
 ('82000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','223456789011','Same prefix','gls-de','in_transit','ok','{}'),
 ('82000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','990000000000000004','Unrelated','swiss-post','in_transit','ok','{"international_tracking_number":"22345678901"}'),
 ('82000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','32345678901','Other owner','gls-de','in_transit','ok','{}'),
 ('82000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','990000000000000006','Other owner local','swiss-post','in_transit','ok','{"international_tracking_number":"32345678901"}'),
 ('82000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','423456789011','Ambiguous A','gls-de','in_transit','ok','{"canonical_tracking_number":"42345678901"}'),
 ('82000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','423456789012','Ambiguous B','gls-ch','in_transit','ok','{"canonical_tracking_number":"42345678901"}'),
 ('82000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','990000000000000009','Ambiguous local','swiss-post','in_transit','ok','{"international_tracking_number":"42345678901"}');
insert into sync_jobs (id,user_id,package_id,kind,dedupe_key) values
 ('82000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','package','auto-link-test');
insert into tracking_events (package_id,stage,description,provider_event_id) values
 ('82000000-0000-0000-0000-000000000001','accepted','GLS accepted','gls-de:auto-link'),
 ('82000000-0000-0000-0000-000000000002','in_transit','Swiss Post arrival','swiss-post:auto-link');

do $$
declare old_generation uuid;
begin
  if has_function_privilege('authenticated','public.auto_link_package_tracking(uuid)','execute') then
    raise exception 'Automatic linking must be service-only';
  end if;
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Must not guess a canonical number, cross owners or resolve an ambiguous match';
  end if;
  -- Swiss Post arrived first. GLS later supplies the actual canonical identifier.
  update packages set carrier_data='{"canonical_tracking_number":"12345678901"}' where id='82000000-0000-0000-0000-000000000001';
  update packages set current_stage='registered' where id='82000000-0000-0000-0000-000000000002';
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Do not replace active international progress with local pre-advice';
  end if;
  update packages set current_stage='out_for_delivery',expected_delivery='2026-09-10' where id='82000000-0000-0000-0000-000000000002';
  select tracking_generation into old_generation from packages where id='82000000-0000-0000-0000-000000000002';
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000002') <> 0 then
    raise exception 'Account-scoped reconciliation affected another owner';
  end if;
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Expected one automatic merge';
  end if;
  if not exists (select 1 from packages where id='82000000-0000-0000-0000-000000000002' and label='Perfume / Surprise' and current_stage='out_for_delivery' and expected_delivery='2026-09-10' and carrier_data->>'original_tracking_number'='123456789011') then
    raise exception 'Name, progress, ETA or original tracking identity lost';
  end if;
  if (select count(*) from tracking_events where package_id='82000000-0000-0000-0000-000000000002' and provider_event_id like '%:auto-link') <> 2 then
    raise exception 'Both histories must survive';
  end if;
  if not exists(select 1 from sync_jobs where id='82000000-0000-0000-0000-000000000099' and package_id='82000000-0000-0000-0000-000000000002') then
    raise exception 'Queued refresh disappeared during merge';
  end if;
  if public.apply_tracking_sync('82000000-0000-0000-0000-000000000002', old_generation, '{"carrier_data":{}}') then
    raise exception 'Stale refresh overwrote merged tracking';
  end if;
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Repeated reconciliation must not duplicate the name';
  end if;
end;
$$;
-- A standalone handoff may happen before the separate delivery entry is added.
insert into packages (id,user_id,tracking_number,label,carrier,current_stage,sync_status,carrier_data) values
 ('83000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','523456789011','GLS order','gls-de','in_transit','ok','{"original_carrier":"gls-de","original_tracking_number":"523456789011","original_canonical_tracking_number":"52345678901","canonical_tracking_number":"990000000000000011","active_tracking_carrier":"swiss-post","active_tracking_number":"990000000000000011"}'),
 ('83000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','990000000000000011','Post name','swiss-post','out_for_delivery','ok','{"international_tracking_number":"52345678901"}'),
 ('83000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','LX123456785NL','AliExpress order','aliexpress','in_transit','ok','{}'),
 ('83000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','990000000000000012','Postal order','swiss-post','in_transit','ok','{"international_tracking_number":"LX123456785NL"}'),
 ('83000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','SY12345678901','Partner order','sunyou','in_transit','ok','{"original_carrier":"sunyou","active_tracking_carrier":"swiss-post","active_tracking_number":"990000000000000013"}'),
 ('83000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','990000000000000013','Local order','swiss-post','in_transit','ok','{}');
do $$
begin
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'Expected postal reference and already-switched parcels to merge';
  end if;
  if not exists(select 1 from packages where id='83000000-0000-0000-0000-000000000002'
    and label='GLS order / Post name' and carrier_data->>'original_carrier'='gls-de'
    and carrier_data->>'original_tracking_number'='523456789011'
    and carrier_data->>'active_tracking_number'='990000000000000011') then
    raise exception 'Cross-number handoff identity was lost during merge';
  end if;
  if not exists(select 1 from packages where id='83000000-0000-0000-0000-000000000004'
    and label='AliExpress order / Postal order' and carrier_data->>'original_carrier'='aliexpress') then
    raise exception 'Postal partner merge lost the original name or carrier';
  end if;
  if public.auto_link_package_tracking('10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Already-merged handoff linked again';
  end if;
end;
$$;
rollback;
