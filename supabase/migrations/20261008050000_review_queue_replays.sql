-- Keeps the two review queues current as new tracking code ships.
--
-- Status observations close by themselves: a sync whose scraper maps a
-- wording closes it as mapped, and a wording a carrier's map leaves unmapped
-- on purpose closes as ignored. Each closing records the server version and
-- why. Support cases are replayed once per server version; see
-- tracking_review_runs.

alter table public.tracking_status_observations
  add column last_seen_version text,
  add column reviewed_version text,
  add column review_note text,
  add constraint tracking_status_observations_versions_check check (
    (last_seen_version is null or length(last_seen_version) between 1 and 100)
    and (reviewed_version is null or length(reviewed_version) between 1 and 100)
    and (review_note is null or length(review_note) between 1 and 500)
  );

comment on column public.tracking_status_observations.last_seen_version is
  'The server version of the latest sighting; null when that server did not say.';
comment on column public.tracking_status_observations.reviewed_version is
  'The server version that closed the row by itself; null for a review by hand.';
comment on column public.tracking_status_observations.review_note is
  'Why the row was closed.';

-- Codes and wordings a carrier's status map leaves unmapped on purpose. A
-- row with no provider code matches only wording that came without one; a
-- row with no description matches every wording of its code.
create table public.tracking_status_intentionally_unmapped (
  id uuid primary key default gen_random_uuid(),
  carrier text not null check (length(carrier) between 1 and 100),
  provider_code text check (provider_code is null or length(provider_code) between 1 and 100),
  description_normalized text check (description_normalized is null or length(description_normalized) between 1 and 500),
  note text not null check (length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint tracking_status_intentionally_unmapped_target_check check (provider_code is not null or description_normalized is not null)
);
create unique index tracking_status_intentionally_unmapped_target_idx on public.tracking_status_intentionally_unmapped
  (carrier, coalesce(provider_code, ''), coalesce(description_normalized, ''));
alter table public.tracking_status_intentionally_unmapped enable row level security;
revoke all on public.tracking_status_intentionally_unmapped from public, anon, authenticated;
grant select, insert, update, delete on public.tracking_status_intentionally_unmapped to service_role;

-- Closes the open observations a deliberate gap covers, all of them or the given keys.
create function public.close_intentionally_unmapped_observations(p_version text, p_keys text[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed integer;
begin
  update public.tracking_status_observations as observed
  set reviewed_at = now(), resolution = 'ignored',
    reviewed_version = nullif(left(p_version, 100), ''), review_note = intended.note
  from public.tracking_status_intentionally_unmapped as intended
  where observed.reviewed_at is null
    and (p_keys is null or observed.observation_key = any(p_keys))
    and intended.carrier = observed.carrier
    and intended.provider_code is not distinct from observed.provider_code
    and (intended.description_normalized is null or intended.description_normalized = observed.description_normalized);
  get diagnostics closed = row_count;
  return closed;
end;
$$;
revoke all on function public.close_intentionally_unmapped_observations(text, text[]) from public, anon, authenticated;
grant execute on function public.close_intentionally_unmapped_observations(text, text[]) to service_role;

create function public.close_intentionally_unmapped_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.close_intentionally_unmapped_observations(null);
  return null;
end;
$$;
revoke all on function public.close_intentionally_unmapped_after_change() from public, anon, authenticated;
create trigger close_intentionally_unmapped_after_change
  after insert or update on public.tracking_status_intentionally_unmapped
  for each statement execute function public.close_intentionally_unmapped_after_change();

-- The running server calls the one-argument form, which the defaults keep.
drop function public.record_tracking_status_observations(jsonb);

-- As before, plus: p_mapped_keys are the keys of wording the server's scraper
-- mapped in the same sync, and p_version names that server. A mapped key
-- closes its open row as mapped, unless the same sync also saw it unmapped.
-- A row closed that way and seen unmapped again by a server that names
-- itself is reopened: the map covers that wording only sometimes.
create function public.record_tracking_status_observations(
  p_observations jsonb,
  p_mapped_keys text[] default '{}',
  p_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version text := nullif(left(p_version, 100), '');
  observed_keys text[];
begin
  if jsonb_typeof(p_observations) <> 'array' or cardinality(p_mapped_keys) > 64 then
    raise exception 'Invalid tracking status observation payload' using errcode = '22023';
  end if;

  with recorded as (
    insert into public.tracking_status_observations as observed (
      observation_key,
      carrier,
      provider_code,
      description_normalized,
      language_guess,
      stage_source,
      chosen_stage,
      sample_event_id,
      last_seen_version
    )
    select distinct on (observation.observation_key)
      observation.observation_key,
      left(observation.carrier, 100),
      nullif(left(observation.provider_code, 100), ''),
      left(observation.description_normalized, 500),
      nullif(left(observation.language_guess, 32), ''),
      left(observation.stage_source, 100),
      left(observation.chosen_stage, 100),
      (
        select event.id
        from public.tracking_events as event
        where event.package_id = observation.package_id
          and event.provider_event_id = observation.provider_event_id
      ),
      version
    from jsonb_to_recordset(p_observations) as observation(
      observation_key text,
      carrier text,
      provider_code text,
      description_normalized text,
      language_guess text,
      stage_source text,
      chosen_stage text,
      package_id uuid,
      provider_event_id text
    )
    where observation.observation_key is not null
      and nullif(observation.carrier, '') is not null
      and nullif(observation.description_normalized, '') is not null
      and nullif(observation.stage_source, '') is not null
      and nullif(observation.chosen_stage, '') is not null
    on conflict (observation_key) do update set
      count = observed.count + 1,
      last_seen = now(),
      stage_source = excluded.stage_source,
      chosen_stage = excluded.chosen_stage,
      sample_event_id = coalesce(excluded.sample_event_id, observed.sample_event_id),
      last_seen_version = excluded.last_seen_version
    returning observed.observation_key
  )
  select coalesce(array_agg(observation_key), '{}') into observed_keys from recorded;

  if version is not null then
    update public.tracking_status_observations
    set reviewed_at = null, resolution = null, reviewed_version = null, review_note = null
    where observation_key = any(observed_keys) and resolution = 'mapped' and reviewed_version is not null;

    update public.tracking_status_observations
    set reviewed_at = now(), resolution = 'mapped', reviewed_version = version,
      review_note = 'The carrier status map gave its stage.'
    where observation_key = any(p_mapped_keys) and not observation_key = any(observed_keys)
      and reviewed_at is null;
  end if;

  perform public.close_intentionally_unmapped_observations(version, observed_keys);
end;
$$;

revoke all on function public.record_tracking_status_observations(jsonb, text[], text)
  from public, anon, authenticated;
grant execute on function public.record_tracking_status_observations(jsonb, text[], text) to service_role;

-- DPD Switzerland's map gives these no stage on purpose (the scraper's
-- carriers/dpd/status.ts and statuses.json). The wordings without a code are
-- the guest API's English labels of the same values, which scans carried
-- before their codes were kept.
insert into public.tracking_status_intentionally_unmapped (carrier, provider_code, description_normalized, note) values
  ('dpd', 'PARCEL_HANDED', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'IN_TRANSIT', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'AT_DELIVERY_CENTER', null, 'DPD''s map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.'),
  ('dpd', 'ORI', null, 'DPD''s map leaves it unmapped on purpose, like its twin PARCEL_HANDED, so an import that cleared customs does not step back to accepted.'),
  ('dpd', null, 'parcel handed to dpd', 'The label of PARCEL_HANDED, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'your parcel is on its way', 'The label of IN_TRANSIT, which DPD''s map leaves unmapped on purpose.'),
  ('dpd', null, 'at delivery center', 'The label of AT_DELIVERY_CENTER, which DPD''s map leaves unmapped on purpose.');

-- One replay of the support backlog per server version. A server claims the
-- version for a lease; another takes it over only once that lease ran out
-- without the run finishing.
create table public.tracking_review_runs (
  version text primary key check (length(version) between 1 and 100),
  started_at timestamptz not null default now(),
  lease_until timestamptz not null,
  attempts integer not null default 1 check (attempts >= 1),
  finished_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 4096))
);
alter table public.tracking_review_runs enable row level security;
-- Only the functions below write runs.
revoke all on public.tracking_review_runs from public, anon, authenticated, service_role;
grant select on public.tracking_review_runs to service_role;

-- 'claimed' when the caller is to run the replay, 'running' while another
-- server holds it, 'done' once a server finished it.
create function public.claim_tracking_review_run(p_version text, p_lease_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.tracking_review_runs;
begin
  if p_version is null or length(p_version) not between 1 and 100
      or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'Invalid tracking review run' using errcode = '22023';
  end if;
  insert into public.tracking_review_runs as claimed (version, lease_until)
  values (p_version, clock_timestamp() + make_interval(secs => p_lease_seconds))
  on conflict (version) do update set
    started_at = now(), lease_until = excluded.lease_until, attempts = claimed.attempts + 1
    where claimed.finished_at is null and claimed.lease_until <= clock_timestamp()
  returning * into run;
  if found then return 'claimed'; end if;
  select * into strict run from public.tracking_review_runs where version = p_version;
  return case when run.finished_at is null then 'running' else 'done' end;
end;
$$;
revoke all on function public.claim_tracking_review_run(text, integer) from public, anon, authenticated;
grant execute on function public.claim_tracking_review_run(text, integer) to service_role;

create function public.finish_tracking_review_run(p_version text, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tracking_review_runs
  set finished_at = now(), result = p_result
  where version = p_version and finished_at is null;
  return found;
end;
$$;
revoke all on function public.finish_tracking_review_run(text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_tracking_review_run(text, jsonb) to service_role;

-- Marks fixed the open cases a replay found no gap for, unless their
-- configured carrier changed since the replay read them. p_cases holds
-- {id, configured_carrier, note} objects.
create function public.fix_replayed_tracking_support_cases(p_version text, p_cases jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixed integer;
begin
  if p_version is null or length(p_version) not between 1 and 100
      or jsonb_typeof(p_cases) <> 'array' or jsonb_array_length(p_cases) > 1000 then
    raise exception 'Invalid tracking support replay' using errcode = '22023';
  end if;
  update public.tracking_support_cases as support_case
  set fix_status = 'fixed', fixed_at = now(), fix_reference = p_version,
    notes = left(coalesce(support_case.notes || E'\n', '') || replayed.note, 4000)
  from jsonb_to_recordset(p_cases) as replayed(id uuid, configured_carrier text, note text)
  where support_case.id = replayed.id
    and support_case.fix_status = 'open'
    and support_case.configured_carrier is not distinct from nullif(replayed.configured_carrier, '')
    and length(replayed.note) between 1 and 500;
  get diagnostics fixed = row_count;
  return fixed;
end;
$$;
revoke all on function public.fix_replayed_tracking_support_cases(text, jsonb) from public, anon, authenticated;
grant execute on function public.fix_replayed_tracking_support_cases(text, jsonb) to service_role;

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008050000_review_queue_replays') on conflict do nothing;
