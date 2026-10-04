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
do $$
begin
  if has_function_privilege('anon','public.set_owned_package_provider_postcode(uuid,text)','execute') then
    raise exception 'Anonymous role can change private provider input';
  end if;
end;
$$;
rollback;
