\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000008', 'dpd-poland-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000008', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
begin
  parcel := public.create_owned_package('1000000000001U', 'DPD Poland fixture', 'dpd-pl');
  if parcel.carrier <> 'dpd-pl' then raise exception 'DPD Poland was lost on creation'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'unknown');
  perform public.change_owned_package_carrier(parcel.id, 'dpd-pl');
  if (select carrier from public.packages where id = parcel.id) <> 'dpd-pl' then
    raise exception 'Carrier change to DPD Poland failed';
  end if;
  -- DPD Poland asks for no postcode.
  begin
    perform public.create_owned_package('13000000000002', 'With a postcode', 'dpd-pl', null, '00-001');
    raise exception 'A DPD Poland postcode was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_owned_package('13000000000003', 'Unknown network', 'dpd-cz');
    raise exception 'Unknown carrier was accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
reset role;
set local role service_role;
do $$
declare answer jsonb;
begin
  answer := public.create_one_off_parcel('13000000000004', 'dpd-pl', null, null, repeat('f', 64));
  if answer#>>'{package,carrier}' is distinct from 'dpd-pl' then
    raise exception 'One-off DPD Poland carrier was lost';
  end if;
end;
$$;
rollback;
