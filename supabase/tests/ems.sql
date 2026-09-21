\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('18000000-0000-0000-0000-000000000001', 'ems-test@example.test');
select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare parcel public.packages;
begin
  parcel := public.create_owned_package('EB000000005CN', 'EMS fixture', 'ems');
  if parcel.carrier <> 'ems' then raise exception 'EMS carrier was lost'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'china-post');
  perform public.change_owned_package_carrier(parcel.id, 'ems');
  if (select carrier from public.packages where id = parcel.id) <> 'ems' then
    raise exception 'EMS carrier change failed';
  end if;
  if (select tracking_number from public.packages where id = parcel.id) <> 'EB000000005CN' then
    raise exception 'EMS carrier change rewrote the postal identifier';
  end if;
  begin
    perform public.change_owned_package_carrier(parcel.id, 'unsupported-carrier');
    raise exception 'Unknown carrier was accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
rollback;
