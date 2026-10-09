-- The sessions the server reads DPD's app service with, kept across deploys.
--
-- DPD's service takes tens of seconds to open a session, and the server opened
-- one on every start. It now takes up the newest one saved here while it is
-- under eight hours old. The scraper checks every session the server stopped
-- using once an hour, and saves when DPD last accepted it and when it began
-- refusing it, so how long DPD accepts a session can be read here. A token is
-- an anonymous session of DPD's public app: it names no account, parcel or
-- person.
--
-- Apply this before deploying the server that uses it. The server before it
-- keeps working on this schema: it does not use the table.

begin;

create table public.dpd_app_sessions (
  token text primary key check (char_length(token) between 16 and 512 and token ~ '^[A-Za-z0-9+/=]+$'),
  opened_at timestamptz not null,
  -- The last time a check found DPD accepting it, once the server stopped using it.
  checked_at timestamptz,
  -- When DPD began refusing it, once the next check repeated the refusal.
  refused_at timestamptz
);
create index dpd_app_sessions_opened_idx on public.dpd_app_sessions(opened_at desc);
alter table public.dpd_app_sessions enable row level security;
revoke all on table public.dpd_app_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.dpd_app_sessions to service_role;

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261009180000_dpd_app_sessions') on conflict do nothing;

commit;
