\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('e8000000-0000-4000-8000-000000000001', 'budget-one@example.test'),
 ('e8000000-0000-4000-8000-000000000002', 'budget-two@example.test');
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.claim_account_tracking(uuid,text,integer)', 'EXECUTE')
        or has_table_privilege(role_name, 'private.account_tracking_usage', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Tracking budgets must be server-only';
    end if;
  end loop;
end;
$$;
set local role service_role;
do $$
declare account_id constant uuid := 'e8000000-0000-4000-8000-000000000001';
begin
  if not public.claim_account_tracking(account_id, 'lookup', 2)
      or not public.claim_account_tracking(account_id, 'lookup', 2)
      or public.claim_account_tracking(account_id, 'lookup', 2)
      or public.claim_account_tracking(account_id, 'lookup', 2) then
    raise exception 'Lookup budget was not enforced';
  end if;
  if not public.claim_account_tracking(account_id, 'detection', 1)
      or public.claim_account_tracking(account_id, 'detection', 1)
      or not public.claim_account_tracking('e8000000-0000-4000-8000-000000000002', 'lookup', 2)
      or public.claim_account_tracking(account_id, 'lookup', 0) then
    raise exception 'Budgets must be independent and support disabling work';
  end if;
end;
$$;
reset role;
update private.account_tracking_usage set day = day - 1;
set local role service_role;
select public.claim_account_tracking('e8000000-0000-4000-8000-000000000001', 'lookup', 1) as reset_allowed \gset
\if :reset_allowed
\else
  \quit 1
\endif
reset role;
delete from auth.users where id in ('e8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002');
do $$ begin
  if exists (select from private.account_tracking_usage where user_id = 'e8000000-0000-4000-8000-000000000001') then
    raise exception 'Account deletion must remove usage';
  end if;
end; $$;
rollback;
