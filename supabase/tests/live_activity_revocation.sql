\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values
 ('96000000-0000-0000-0000-000000000001', 'revocation-a@example.invalid'),
 ('96000000-0000-0000-0000-000000000002', 'revocation-b@example.invalid');
insert into auth.sessions(id, user_id) values
 ('96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000001'),
 ('96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000002');
set local role service_role;
insert into public.live_activity_devices(user_id, session_id, installation_id, token, environment, revocation_hash)
values ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003',
 '96000000-0000-0000-0000-000000000005', repeat('ab',32), 'development', repeat('11',32));
select public.revoke_live_activity_device('96000000-0000-0000-0000-000000000005', repeat('11',32));
do $$ begin
  if exists(select 1 from public.live_activity_devices where installation_id='96000000-0000-0000-0000-000000000005') then
    raise exception 'Revocation failed';
  end if;
  begin
    insert into public.live_activity_devices(user_id, session_id, installation_id, token, environment, revocation_hash)
    values ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003',
      '96000000-0000-0000-0000-000000000005', repeat('ab',32), 'development', repeat('11',32));
    raise exception 'Late registration resurrected revoked binding';
  exception when check_violation then null; end;
  begin
    insert into public.live_activity_devices(user_id, session_id, installation_id, token, environment, revocation_hash)
    values ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000004',
      '96000000-0000-0000-0000-000000000005', repeat('ab',32), 'development', repeat('33',32));
    raise exception 'Accepted another account session';
  exception when check_violation then null; end;
end; $$;
insert into public.live_activity_devices(user_id, session_id, installation_id, token, environment, revocation_hash)
values ('96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000004',
 '96000000-0000-0000-0000-000000000005', repeat('ab',32), 'development', repeat('22',32));
select public.revoke_live_activity_device('96000000-0000-0000-0000-000000000005', repeat('11',32));
do $$ begin
  if not exists(select 1 from public.live_activity_devices where installation_id='96000000-0000-0000-0000-000000000005') then
    raise exception 'Old cleanup deleted a newer binding';
  end if;
  if has_function_privilege('anon', 'public.revoke_live_activity_device(uuid,text)', 'execute') then
    raise exception 'Anonymous SQL access to revocation RPC';
  end if;
end; $$;
reset role;
delete from auth.sessions where id='96000000-0000-0000-0000-000000000004';
do $$ begin
  if exists(select 1 from public.live_activity_devices where installation_id='96000000-0000-0000-0000-000000000005') then
    raise exception 'Revoked session retained Live Activity tokens';
  end if;
end; $$;
rollback;
