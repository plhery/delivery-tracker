\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('98000000-0000-0000-0000-000000000002', 'catalog@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000002', true);

do $$
declare
  parcel public.packages;
  carrier_id text;
begin
  foreach carrier_id in array array[
    'cne', 'dpd-de', 'dpd-uk', 'ekart', 'evri-uk', 'intelcom',
    'lbc-express', 'nova-poshta', 'sagawa', 'speedpak', 'spx-ph', 'xpressbees'
  ] loop
    select * into parcel from public.create_owned_package('TEST' || replace(carrier_id, '-', '') || '123', '', carrier_id);
    if parcel.carrier <> carrier_id or parcel.user_id <> auth.uid() then
      raise exception 'Catalog carrier was not preserved with its owner';
    end if;
    perform public.change_owned_package_carrier(parcel.id, 'unknown');
    if not public.change_owned_package_carrier(parcel.id, carrier_id) then
      raise exception 'Catalog carrier could not be selected';
    end if;
  end loop;
  select * into parcel from public.create_owned_package('12345678901234', '', 'dpd-de', null, '00007');
  if parcel.dpd_postcode <> '00007' then raise exception 'Leading-zero postcode was lost'; end if;
  perform public.change_owned_package_carrier(parcel.id, 'dpd-de', null, null);
  if (select dpd_postcode from public.packages where id = parcel.id) is not null then
    raise exception 'Optional postcode was not cleared';
  end if;
  begin
    perform public.create_owned_package('12345678901235', '', 'dpd-de', null, '0007');
    raise exception 'Accepted a short German postcode' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.change_owned_package_carrier(parcel.id, 'dpd-de', null, '000007');
    raise exception 'Accepted a long German postcode' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.change_owned_package_carrier(parcel.id, 'dpd-uk', null, '00007');
    raise exception 'Accepted a carrier-specific input for another carrier' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.change_owned_package_carrier(parcel.id, 'unregistered-carrier');
    raise exception 'Accepted an unregistered carrier' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
end;
$$;
rollback;
