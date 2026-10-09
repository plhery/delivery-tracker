\set ON_ERROR_STOP on
begin;

-- Only the server reads and writes the DPD app sessions.
do $$
begin
  if has_table_privilege('anon', 'public.dpd_app_sessions', 'SELECT')
      or has_table_privilege('authenticated', 'public.dpd_app_sessions', 'SELECT')
      or has_table_privilege('authenticated', 'public.dpd_app_sessions', 'INSERT') then
    raise exception 'public database roles can read the DPD app sessions';
  end if;
  if not has_table_privilege('service_role', 'public.dpd_app_sessions', 'SELECT')
      or not has_table_privilege('service_role', 'public.dpd_app_sessions', 'INSERT')
      or not has_table_privilege('service_role', 'public.dpd_app_sessions', 'UPDATE') then
    raise exception 'the service role cannot keep the DPD app sessions';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.dpd_app_sessions'::regclass)
      or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dpd_app_sessions') then
    raise exception 'the DPD app sessions are readable through row level security';
  end if;
end;
$$;

-- A session is saved again under its token, and only a token's characters are taken.
insert into public.dpd_app_sessions (token, opened_at)
values ('U1lOVEhFVElDX1NFU1NJT04=', '2026-10-09T08:00:00Z');
insert into public.dpd_app_sessions (token, opened_at, checked_at, refused_at)
values ('U1lOVEhFVElDX1NFU1NJT04=', '2026-10-09T08:00:00Z', '2026-10-10T07:00:00Z', '2026-10-10T08:00:00Z')
on conflict (token) do update set checked_at = excluded.checked_at, refused_at = excluded.refused_at;
do $$
begin
  if (select refused_at - opened_at from public.dpd_app_sessions where token = 'U1lOVEhFVElDX1NFU1NJT04=') <> interval '24 hours' then
    raise exception 'a DPD app session was not saved again under its token';
  end if;
  begin
    insert into public.dpd_app_sessions (token, opened_at) values ('not a token', now());
    raise exception 'a DPD app session took a malformed token';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
