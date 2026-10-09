\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000009', 'emile-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000009', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
begin
  parcel := public.create_owned_package('EM000000000001CA', 'Emile fixture', 'emile');
  if parcel.carrier <> 'emile' then raise exception 'Emile was lost on creation'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'unknown');
  perform public.change_owned_package_carrier(parcel.id, 'emile');
  if (select carrier from public.packages where id = parcel.id) <> 'emile' then
    raise exception 'Carrier change to Emile failed';
  end if;
  -- Emile asks for no postcode.
  begin
    perform public.create_owned_package('EM000000000002CA', 'With a postcode', 'emile', null, 'A1A1A1');
    raise exception 'An Emile postcode was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_owned_package('EM000000000003CA', 'Unknown courier', 'emile-express');
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
  answer := public.create_one_off_parcel('EM000000000004CA', 'emile', null, null, repeat('f', 64));
  if answer#>>'{package,carrier}' is distinct from 'emile' then
    raise exception 'One-off Emile carrier was lost';
  end if;
end;
$$;
rollback;
