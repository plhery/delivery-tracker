-- Carrier wording the sync could not resolve from a carrier status map is
-- collected here so it can be mapped later. One row per distinct
-- carrier/code/wording combination, counted instead of duplicated.
--
-- Privacy: no tracking number, package or user reference is stored. The
-- optional sample event id is an opaque join key into the account-private
-- tracking history for an operator who already has database access.

create table public.tracking_status_observations (
  id uuid primary key default gen_random_uuid(),
  observation_key text not null unique,
  carrier text not null,
  provider_code text,
  description_normalized text not null,
  language_guess text,
  stage_source text not null,
  chosen_stage text not null,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  sample_event_id uuid references public.tracking_events (id) on delete set null,
  reviewed_at timestamptz,
  resolution text,
  constraint tracking_status_observations_key_check check (
    length(observation_key) = 64
  ),
  constraint tracking_status_observations_carrier_check check (
    length(carrier) between 1 and 100
    and (provider_code is null or length(provider_code) between 1 and 100)
  ),
  constraint tracking_status_observations_description_check check (
    length(description_normalized) between 1 and 500
  ),
  constraint tracking_status_observations_language_check check (
    language_guess is null or length(language_guess) between 1 and 32
  ),
  constraint tracking_status_observations_stage_source_check check (
    length(stage_source) between 1 and 100
  ),
  constraint tracking_status_observations_stage_check check (
    length(chosen_stage) between 1 and 100
  ),
  constraint tracking_status_observations_count_check check (count >= 1),
  constraint tracking_status_observations_resolution_check check (
    resolution is null or resolution in ('mapped', 'ignored', 'wording_rule')
  )
);

create index tracking_status_observations_review_idx
  on public.tracking_status_observations (carrier, reviewed_at);

alter table public.tracking_status_observations enable row level security;
revoke all on public.tracking_status_observations from public, anon, authenticated;
grant select, insert, update, delete on public.tracking_status_observations to service_role;

-- Upsert a bounded batch of observations at the end of a sync. An existing
-- wording keeps its first_seen and grows its count; the most recent decision
-- and sample replace the stored ones so a review always sees current evidence.
--
-- package_id and provider_event_id are used only to resolve one sample event
-- through the unique (package_id, provider_event_id) index. They are not stored.
create function public.record_tracking_status_observations(p_observations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'Invalid tracking status observation payload' using errcode = '22023';
  end if;

  insert into public.tracking_status_observations as observed (
    observation_key,
    carrier,
    provider_code,
    description_normalized,
    language_guess,
    stage_source,
    chosen_stage,
    sample_event_id
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
    )
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
    sample_event_id = coalesce(excluded.sample_event_id, observed.sample_event_id);
end;
$$;

revoke all on function public.record_tracking_status_observations(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_tracking_status_observations(jsonb) to service_role;

comment on table public.tracking_status_observations is
  'Carrier wording whose stage was classified or fell back, grouped for review; holds no tracking number, package or user reference.';
comment on column public.tracking_status_observations.observation_key is
  'sha256 of carrier, provider code and normalized description; the upsert identity.';
comment on column public.tracking_status_observations.stage_source is
  'How the stage was decided: wording:<rule> for a classifier rule, none for the fallback.';
comment on column public.tracking_status_observations.sample_event_id is
  'Optional opaque tracking event to inspect; cleared when that event is deleted.';
comment on column public.tracking_status_observations.resolution is
  'Set with reviewed_at once the wording is mapped, deliberately ignored, or turned into a wording rule.';

notify pgrst, 'reload schema';
