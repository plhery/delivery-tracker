\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000010', 'gofo-regions-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000010', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
  region text;
begin
  foreach region in array array['gofo-fr', 'gofo-it'] loop
    parcel := public.create_owned_package(upper('GF' || right(region, 2)) || '0000000000001', 'GOFO fixture', region);
    if parcel.carrier <> region then raise exception '% was lost on creation', region; end if;
    perform public.change_owned_package_carrier(parcel.id, 'gofo');
    perform public.change_owned_package_carrier(parcel.id, region);
    if (select carrier from public.packages where id = parcel.id) <> region then
      raise exception 'Carrier change to % failed', region;
    end if;
    -- Neither region asks for a postcode.
    begin
      perform public.create_owned_package(upper('GF' || right(region, 2)) || '0000000000002', 'With a postcode', region, null, '75001');
      raise exception 'A % postcode was accepted', region;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.create_owned_package('GFES0000000000003', 'Unknown region', 'gofo-es');
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
  answer := public.create_one_off_parcel('GFIT0000000000004', 'gofo-it', null, null, repeat('f', 64));
  if answer#>>'{package,carrier}' is distinct from 'gofo-it' then
    raise exception 'One-off GOFO Italy carrier was lost';
  end if;
end;
$$;
rollback;
