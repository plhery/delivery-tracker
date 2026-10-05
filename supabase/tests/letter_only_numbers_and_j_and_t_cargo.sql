\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('19000000-0000-0000-0000-000000000006', 'letter-only-test@example.test');
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000006', true);
set local role authenticated;
do $$
declare parcel public.packages;
begin
  -- Six or more letters are a tracking number; fewer letters and no digit are not.
  parcel := public.create_owned_package('aal zjr', 'Track ID fixture', 'unknown');
  if parcel.tracking_number <> 'AALZJR' then raise exception 'Letter-only number was rewritten'; end if;
  begin
    perform public.create_owned_package('ABCDE', 'Too short', 'unknown');
    raise exception 'Five letters were accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_owned_package('ABCDE-', 'Punctuation only', 'unknown');
    raise exception 'Five letters and a dash were accepted';
  exception when sqlstate '22023' then null;
  end;

  -- The format constraint agrees with the function about the NACEX composite.
  parcel := public.create_owned_package('1234/12345678', 'NACEX fixture', 'nacex');
  if parcel.tracking_number <> '1234/12345678' then raise exception 'NACEX composite was rewritten'; end if;

  parcel := public.create_owned_package('200000000001', 'J&T Cargo fixture', 'j-and-t-cargo');
  if parcel.carrier <> 'j-and-t-cargo' then raise exception 'J&T Cargo carrier was lost'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'unknown');
  perform public.change_owned_package_carrier(parcel.id, 'j-and-t-cargo');
  if (select carrier from public.packages where id = parcel.id) <> 'j-and-t-cargo' then
    raise exception 'J&T Cargo carrier change failed';
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
  answer := public.create_one_off_parcel('AALZJS', 'unknown', null, null, repeat('b', 64));
  if answer#>>'{package,tracking_number}' is distinct from 'AALZJS' then
    raise exception 'One-off letter-only number was lost';
  end if;
  answer := public.create_one_off_parcel('200000000002', 'j-and-t-cargo', null, null, repeat('c', 64));
  if answer#>>'{package,carrier}' is distinct from 'j-and-t-cargo' then
    raise exception 'One-off J&T Cargo carrier was lost';
  end if;
  begin
    perform public.create_one_off_parcel('ABCDE', 'unknown', null, null, repeat('d', 64));
    raise exception 'One-off five letters were accepted';
  exception when sqlstate '22023' then null;
  end;

  -- A support case can be opened for a letter-only number, and still not for a short word.
  if public.record_tracking_support_observation('AALZJT', '{"reasons":["unknown_shape"]}', '{}', now(), 'test:letters') is null then
    raise exception 'Letter-only support observation was refused';
  end if;
  begin
    perform public.record_tracking_support_observation('ABCDE', '{"reasons":["unknown_shape"]}', '{}', now(), 'test:short-letters');
    raise exception 'Five-letter support observation was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
rollback;
