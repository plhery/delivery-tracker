\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('98000000-0000-0000-0000-000000000004', 'postcode@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000004', true);

do $$
declare
  parcel public.packages;
  typed text;
  stored text;
begin
  select * into parcel from public.create_owned_package('06080000000011', '', 'dpd');
  if parcel.dpd_postcode is not null then raise exception 'DPD postcode is no longer optional'; end if;
  foreach typed in array array['8000', '75001', 'sw1a  1aa', '1012 ab', '00-001'] loop
    stored := upper(regexp_replace(typed, ' +', ' ', 'g'));
    perform public.change_owned_package_carrier(parcel.id, 'dpd', null, typed);
    if (select dpd_postcode from public.packages where id = parcel.id) is distinct from stored then
      raise exception 'DPD postcode % was not stored as %', typed, stored;
    end if;
  end loop;
  select * into parcel from public.create_owned_package('06080000000012', '', 'dpd', null, ' 75001 ');
  if parcel.dpd_postcode <> '75001' then raise exception 'French postcode was not saved for DPD'; end if;
  foreach typed in array array['12', 'ABCDE', '1234567890123', '75001/2', '75 - 001'] loop
    begin
      perform public.change_owned_package_carrier(parcel.id, 'dpd', null, typed);
      raise exception 'Accepted the DPD postcode %', typed using errcode = 'P0002';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.create_owned_package('06080000000013', '', 'dpd', null, typed);
      raise exception 'Created a DPD parcel with the postcode %', typed using errcode = 'P0002';
    exception when invalid_parameter_value then null; end;
  end loop;
  -- Other carriers keep their own shape.
  begin
    perform public.create_owned_package('12345678901236', '', 'dpd-de', null, 'SW1A 1AA');
    raise exception 'Accepted a foreign postcode for DPD Germany' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_owned_package('993990103198', '', 'gls-ch', null, '75001');
    raise exception 'Accepted a French postcode for GLS Switzerland' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
end;
$$;

reset role;
do $$
begin
  begin
    update public.packages set dpd_postcode = 'sw1a 1aa' where tracking_number = '06080000000012';
    raise exception 'Stored a lowercase DPD postcode' using errcode = 'P0002';
  exception when check_violation then null; end;
  begin
    update public.packages set carrier = 'gls-ch' where tracking_number = '06080000000012';
    raise exception 'Kept a French postcode on GLS Switzerland' using errcode = 'P0002';
  exception when check_violation then null; end;
end;
$$;
rollback;
