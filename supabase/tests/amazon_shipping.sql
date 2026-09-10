\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('17000000-0000-0000-0000-000000000001', 'amazon-test@example.test');
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare parcel public.packages;
begin
  parcel := public.create_owned_package('UK0000000001', 'Shipping', 'amazon-shipping');
  if parcel.carrier <> 'amazon-shipping' then raise exception 'Shipping carrier was lost'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'amazon-logistics');
  perform public.change_owned_package_carrier(parcel.id, 'amazon-shipping');
  if (select carrier from public.packages where id = parcel.id) <> 'amazon-shipping' then
    raise exception 'Shipping carrier change failed';
  end if;
  parcel := public.create_owned_package('TBA000000000001', 'US Shipping', 'amazon-shipping');
  if parcel.tracking_number <> 'TBA000000000001' then raise exception 'US number was changed'; end if;
end;
$$;
rollback;
