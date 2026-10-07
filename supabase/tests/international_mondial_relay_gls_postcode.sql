\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('98000000-0000-0000-0000-000000000005', 'postcode-mr-gls@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000005', true);

do $$
declare
  carrier_id text;
  number text;
  parcel public.packages;
  typed text;
  stored text;
begin
  foreach carrier_id in array array['mondial-relay', 'gls-de'] loop
    number := case carrier_id when 'mondial-relay' then '76434221' else '12345678904' end;
    -- Still required for an 8-digit shipment and for GLS.
    begin
      perform public.create_owned_package(number, '', carrier_id);
      raise exception 'Created a % parcel without its postcode', carrier_id using errcode = 'P0002';
    exception when invalid_parameter_value then null; end;
    select * into parcel from public.create_owned_package(number, '', carrier_id, null, ' 75001 ');
    if parcel.dpd_postcode <> '75001' then raise exception 'French postcode was not saved for %', carrier_id; end if;
    foreach typed in array array['1000', 'l-1234', '1012  ab', '1000-001', '28001', 'sw1a 1aa'] loop
      stored := upper(regexp_replace(typed, ' +', ' ', 'g'));
      perform public.change_owned_package_carrier(parcel.id, carrier_id, null, typed);
      if (select dpd_postcode from public.packages where id = parcel.id) is distinct from stored then
        raise exception '% postcode % was not stored as %', carrier_id, typed, stored;
      end if;
    end loop;
    foreach typed in array array['12', 'ABCDE', '1234567890123', '75001/2', '75 - 001'] loop
      begin
        perform public.change_owned_package_carrier(parcel.id, carrier_id, null, typed);
        raise exception 'Accepted the % postcode %', carrier_id, typed using errcode = 'P0002';
      exception when invalid_parameter_value then null; end;
    end loop;
  end loop;

  -- Mondial Relay's 10- and 12-digit forms and its label barcodes need none.
  foreach number in array array['1276434222', '127643422301', '12123456780101006623123454'] loop
    select * into parcel from public.create_owned_package(number, '', 'mondial-relay');
    if parcel.dpd_postcode is not null then raise exception 'Mondial Relay % kept a postcode', number; end if;
    perform public.change_owned_package_carrier(parcel.id, 'mondial-relay', null, '1000');
    if (select dpd_postcode from public.packages where id = parcel.id) <> '1000' then
      raise exception 'Mondial Relay % lost the postcode it was given', number;
    end if;
  end loop;

  -- Heppner keeps its Swiss or French shape.
  begin
    perform public.create_owned_package('23456789', '', 'heppner', null, '1012 AB');
    raise exception 'Accepted a Dutch postcode for Heppner' using errcode = 'P0002';
  exception when invalid_parameter_value then null; end;
end;
$$;

reset role;
do $$
begin
  begin
    update public.packages set dpd_postcode = '1012 ab' where tracking_number = '76434221';
    raise exception 'Stored a lowercase Mondial Relay postcode' using errcode = 'P0002';
  exception when check_violation then null; end;
  begin
    update public.packages set carrier = 'heppner' where tracking_number = '12345678904';
    raise exception 'Kept a British postcode on Heppner' using errcode = 'P0002';
  exception when check_violation then null; end;
end;
$$;
rollback;
