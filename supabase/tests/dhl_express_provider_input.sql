\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('19000000-0000-0000-0000-000000000002','express-owner@example.test'),
 ('19000000-0000-0000-0000-000000000003','express-other@example.test');
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
declare parcel public.packages; original_generation uuid;
begin
  parcel := public.create_owned_package('1234567891','Express fixture','dhl-express');
  original_generation := parcel.tracking_generation;
  perform public.change_owned_package_carrier(parcel.id,'unknown');
  perform public.change_owned_package_carrier(parcel.id,'dhl-express');
  select tracking_generation into original_generation from public.packages where id=parcel.id;
  if not public.set_owned_package_provider_postcode(parcel.id,'m5v 3l9') then raise exception 'Provider postcode was not saved'; end if;
  if not exists (select 1 from public.packages where id=parcel.id and carrier='dhl-express' and dpd_postcode is null
     and carrier_data#>>'{universal_input,number}'='1234567891' and carrier_data#>>'{universal_input,postcode}'='M5V 3L9'
     and tracking_generation<>original_generation and sync_status='pending') then
    raise exception 'Provider input changed carrier credentials or lost number binding';
  end if;
  perform set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000003',true);
  if public.set_owned_package_provider_postcode(parcel.id,'8000') then raise exception 'Another owner changed provider input'; end if;
  begin
    perform public.set_owned_package_provider_postcode(parcel.id,'<script>123');
    raise exception 'Invalid provider input accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
reset role;
insert into public.sync_jobs(id,user_id,package_id,kind,state,dedupe_key,locked_by,lease_until)
select '19000000-0000-0000-0000-000000000004', user_id, id, 'package', 'running',
       'package:' || id, 'synthetic-worker', now() + interval '1 minute'
from public.packages where user_id='19000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.set_owned_package_provider_postcode(id,'8000') from public.packages
where user_id='19000000-0000-0000-0000-000000000002';
reset role;
do $$
begin
  if not exists (select 1 from public.sync_jobs
      where id='19000000-0000-0000-0000-000000000004' and state='failed'
        and dedupe_key is null and locked_by is null and lease_until is null
        and completed_at is not null) then
    raise exception 'Provider input did not supersede the older sync job';
  end if;
end;
$$;
-- The route can enqueue fresh work using the same parcel key.
insert into public.sync_jobs(user_id,package_id,kind,dedupe_key)
select user_id,id,'package','package:' || id from public.packages
where user_id='19000000-0000-0000-0000-000000000002';
do $$
begin
  if has_function_privilege('anon','public.set_owned_package_provider_postcode(uuid,text)','execute') then
    raise exception 'Anonymous role can change private provider input';
  end if;
end;
$$;
rollback;
