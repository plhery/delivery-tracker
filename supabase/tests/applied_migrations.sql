\set ON_ERROR_STOP on
begin;
set local role anon;
do $$
begin
  if public.missing_migrations(array['20260701000000_init', '20261008010000_applied_migrations',
      '29991231000000_not_yet', '29991231000001_nor_this']) <> array['29991231000000_not_yet', '29991231000001_nor_this'] then
    raise exception 'missing_migrations named the wrong migrations';
  end if;
  if public.missing_migrations('{}') <> '{}' then raise exception 'An empty list lacked something'; end if;
  begin
    perform 1 from public.applied_migrations;
    raise exception 'Anyone could read the applied migrations' using errcode = 'P0002';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  insert into public.applied_migrations (name) values ('29991231000000_not_yet');
  raise exception 'An account could record a migration' using errcode = 'P0002';
exception when insufficient_privilege then null;
end;
$$;
rollback;
