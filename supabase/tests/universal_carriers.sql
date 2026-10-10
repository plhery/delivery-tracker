\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000011', 'universal-carriers-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000011', true);
set local role authenticated;
do $$
declare
  parcel public.packages;
  carrier_id text;
  serial integer := 0;
begin
  foreach carrier_id in array array[
    'abf-freight', 'acs-courier', 'allegro-one', 'apc-overnight', 'aras-kargo',
    'box-now', 'cdek', 'ceska-posta', 'chit-chats', 'correos-de-mexico',
    'cyprus-post', 'day-ross', 'dsv', 'dx', 'dynalogic', 'envialia',
    'epost-global', 'estes', 'fan-courier', 'gebrueder-weiss',
    'geniki-taxydromiki', 'gls-es', 'gls-it', 'jitsu', 'kuehne-nagel',
    'latvijas-pasts', 'loomis-express', 'lso', 'magyar-posta', 'meest',
    'mng-kargo', 'nationex', 'post-luxembourg', 'posta-slovenije',
    'posta-srbije', 'ptt', 'redpack', 'rl-carriers', 'russian-post', 'saia',
    'sameday', 'speedy', 'trans-o-flex', 'ubi-smart-parcel', 'wanbexpress',
    'whistl', 'xdp', 'xpo-ltl', 'yurtici-kargo', 'zeleris'
  ] loop
    serial := serial + 1;
    parcel := public.create_owned_package('UC' || lpad(serial::text, 10, '0'), 'Universal fixture', carrier_id);
    if parcel.carrier <> carrier_id then raise exception '% was lost on creation', carrier_id; end if;
    perform public.change_owned_package_carrier(parcel.id, 'unknown');
    perform public.change_owned_package_carrier(parcel.id, carrier_id);
    if (select carrier from public.packages where id = parcel.id) <> carrier_id then
      raise exception 'Carrier change to % failed', carrier_id;
    end if;
    -- None of them asks for a postcode.
    begin
      perform public.create_owned_package('UP' || lpad(serial::text, 10, '0'), 'With a postcode', carrier_id, null, '75001');
      raise exception 'A % postcode was accepted', carrier_id;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.create_owned_package('UC0000000099', 'Unknown carrier', 'gls-us');
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
  answer := public.create_one_off_parcel('UC0000000098', 'speedy', null, null, repeat('f', 64));
  if answer#>>'{package,carrier}' is distinct from 'speedy' then
    raise exception 'One-off Speedy carrier was lost';
  end if;
end;
$$;
rollback;
