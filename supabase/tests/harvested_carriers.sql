\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000012', 'harvested-carriers-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000012', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
  carrier_id text;
  serial integer := 0;
begin
  foreach carrier_id in array array[
    '99minutos', 'cargus', 'cdl', 'dao', 'dpd-ie', 'early-bird', 'econt',
    'elta', 'express-one', 'foxpost', 'geis', 'go-express', 'helthjem',
    'hrvatska-posta', 'instabox', 'lietuvos-pastas', 'maltapost', 'matkahuolto',
    'omniva', 'orlen-paczka', 'osm-worldwide', 'paquetexpress', 'passport',
    'ppl', 'slovak-parcel-service', 'slovenska-posta', 'stallion-express',
    'venipak', 'vinted-go'
  ] loop
    serial := serial + 1;
    parcel := public.create_owned_package('HC' || lpad(serial::text, 10, '0'), 'Universal fixture', carrier_id);
    if parcel.carrier <> carrier_id then raise exception '% was lost on creation', carrier_id; end if;
    perform public.change_owned_package_carrier(parcel.id, 'unknown');
    perform public.change_owned_package_carrier(parcel.id, carrier_id);
    if (select carrier from public.packages where id = parcel.id) <> carrier_id then
      raise exception 'Carrier change to % failed', carrier_id;
    end if;
    -- None of them asks for a postcode.
    begin
      perform public.create_owned_package('HP' || lpad(serial::text, 10, '0'), 'With a postcode', carrier_id, null, '75001');
      raise exception 'A % postcode was accepted', carrier_id;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.create_owned_package('HC0000000099', 'Unknown carrier', 'pitney-bowes');
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
  answer := public.create_one_off_parcel('HC0000000098', 'omniva', null, null, repeat('f', 64));
  if answer#>>'{package,carrier}' is distinct from 'omniva' then
    raise exception 'One-off Omniva carrier was lost';
  end if;
end;
$$;
rollback;
