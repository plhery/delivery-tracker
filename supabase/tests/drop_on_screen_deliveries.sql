\set ON_ERROR_STOP on
begin;

-- Nothing asks which parcels out for delivery are on screen any more.
do $$
begin
  if to_regprocedure('public.viewed_delivery_ids(timestamptz)') is not null then
    raise exception 'viewed_delivery_ids is still there';
  end if;
end;
$$;

-- The reads it looked at still tell who is waiting for a parcel.
do $$
begin
  if to_regprocedure('public.unwatched_package_ids(timestamptz)') is null
      or not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'account_activity' and column_name = 'last_opened_at')
      or not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'parcel_links' and column_name = 'last_opened_at') then
    raise exception 'Dropping viewed_delivery_ids took the reads with it';
  end if;
end;
$$;

rollback;
