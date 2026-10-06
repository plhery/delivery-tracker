\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000007', 'dhl-networks-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000007', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
  network text;
  serial int := 0;
begin
  foreach network in array array['dhl-ecommerce-es', 'dhl-ecommerce-nl', 'dhl-ecommerce-pl', 'dhl-ecommerce-uk'] loop
    serial := serial + 1;
    parcel := public.create_owned_package('9999000000000' || serial, 'Network fixture', network);
    if parcel.carrier <> network then raise exception '% was lost on creation', network; end if;
    perform public.change_owned_package_carrier(parcel.id, 'unknown');
    perform public.change_owned_package_carrier(parcel.id, network);
    if (select carrier from public.packages where id = parcel.id) <> network then
      raise exception 'Carrier change to % failed', network;
    end if;
  end loop;
  begin
    perform public.create_owned_package('99990000000009', 'Unknown network', 'dhl-ecommerce-fr');
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
  answer := public.create_one_off_parcel('99990000000008', 'dhl-ecommerce-uk', null, null, repeat('e', 64));
  if answer#>>'{package,carrier}' is distinct from 'dhl-ecommerce-uk' then
    raise exception 'One-off DHL eCommerce UK carrier was lost';
  end if;
end;
$$;
rollback;
