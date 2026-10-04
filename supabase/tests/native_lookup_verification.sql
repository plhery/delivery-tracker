\set ON_ERROR_STOP on
begin;
do $$
declare role_name text; table_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name, 'public.register_native_attest_key(text,text,text,text,timestamptz)', 'EXECUTE')
      or has_function_privilege(role_name, 'public.get_native_attest_key(text)', 'EXECUTE')
      or has_function_privilege(role_name, 'public.accept_native_assertion(text,bigint,text,timestamptz,text,integer)', 'EXECUTE') then
      raise exception 'Native verification must be server-only';
    end if;
    foreach table_name in array array['native_attest_keys','native_used_challenges','native_tracking_usage'] loop
      if has_table_privilege(role_name, 'private.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'Native verification tables must be private';
      end if;
    end loop;
  end loop;
end; $$;
set local role service_role;
do $$
declare key_id constant text := repeat('A',43) || '='; expiry constant timestamptz := now() + interval '1 minute';
begin
  if not public.register_native_attest_key(key_id, 'synthetic public key', 'TESTTEAM01.com.example.Peek', repeat('a',64), expiry)
    or public.register_native_attest_key(key_id, 'synthetic public key', 'TESTTEAM01.com.example.Peek', repeat('a',64), expiry)
    or public.register_native_attest_key(key_id, 'synthetic public key', 'TESTTEAM01.com.example.Peek', repeat('b',64), now() - interval '1 second') then
    raise exception 'Attestation challenges must be fresh and single-use';
  end if;
  if public.accept_native_assertion(key_id, 1, repeat('b',64), expiry, 'lookup', 2) <> 'accepted'
    or public.accept_native_assertion(key_id, 2, repeat('b',64), expiry, 'lookup', 2) <> 'rejected'
    or public.accept_native_assertion(key_id, 1, repeat('c',64), expiry, 'lookup', 2) <> 'rejected'
    or public.accept_native_assertion(key_id, 2, repeat('c',64), expiry, 'lookup', 2) <> 'accepted'
    or public.accept_native_assertion(key_id, 3, repeat('d',64), expiry, 'lookup', 2) <> 'limited'
    or public.accept_native_assertion(key_id, 3, repeat('e',64), expiry, 'detection', 2) <> 'rejected'
    or public.accept_native_assertion(key_id, 4, repeat('e',64), expiry, 'detection', 2) <> 'accepted'
    or public.accept_native_assertion(key_id, 5, repeat('f',64), expiry, 'detection', 0) <> 'limited' then
    raise exception 'Counters, replay checks and independent budgets must hold';
  end if;
  if not public.register_native_attest_key(key_id, 'synthetic public key', 'TESTTEAM01.com.example.Peek', repeat('1',64), expiry)
    or (public.get_native_attest_key(key_id)->>'sign_count')::bigint <> 5 then
    raise exception 'Re-registration must not reset counters';
  end if;
  if public.register_native_attest_key(key_id, 'different public key', 'TESTTEAM01.com.example.Peek', repeat('2',64), expiry)
    or public.accept_native_assertion(repeat('B',43)||'=', 1, repeat('3',64), expiry, 'lookup', 1) <> 'rejected' then
    raise exception 'Registered keys must be immutable';
  end if;
end; $$;
reset role;
update private.native_tracking_usage set day = day - 1;
set local role service_role;
do $$ begin
  if public.accept_native_assertion(repeat('A',43)||'=', 6, repeat('4',64), now()+interval '1 minute', 'lookup', 1) <> 'accepted' then
    raise exception 'Budgets must reset each UTC day';
  end if;
end; $$;
reset role;
update private.native_attest_keys set last_seen_at = now() - interval '91 days';
set local role service_role;
do $$ begin
  if public.get_native_attest_key(repeat('A',43)||'=') is not null then raise exception 'Expired keys must not be accepted'; end if;
  perform public.register_native_attest_key(repeat('B',43)||'=', 'synthetic public key', 'TESTTEAM01.com.example.Peek', repeat('5',64), now()+interval '1 minute');
end; $$;
reset role;
do $$ begin
  if exists(select from private.native_tracking_usage where key_id = repeat('A',43)||'=') then raise exception 'Removing keys must remove their budgets'; end if;
end; $$;
rollback;
