\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000001', 'omgo-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare parcel public.packages;
begin
  parcel := public.create_owned_package('OMGO00000001', 'OMGO fixture', 'omgo');
  if parcel.carrier <> 'omgo' then raise exception 'OMGO carrier was lost'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'unknown');
  perform public.change_owned_package_carrier(parcel.id, 'omgo');
  if (select carrier from public.packages where id = parcel.id) <> 'omgo' then
    raise exception 'OMGO carrier change failed';
  end if;
  if (select tracking_number from public.packages where id = parcel.id) <> 'OMGO00000001' then
    raise exception 'OMGO carrier change rewrote the tracking number';
  end if;
  begin
    perform public.change_owned_package_carrier(parcel.id, 'unsupported-carrier');
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
  answer := public.create_one_off_parcel('OMGO00000002', 'omgo', null, null, repeat('a', 64));
  if answer#>>'{package,carrier}' is distinct from 'omgo' then
    raise exception 'One-off OMGO carrier was lost';
  end if;
end;
$$;
rollback;
