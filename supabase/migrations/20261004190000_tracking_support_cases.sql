alter table public.tracking_sync_attempts add column support_context jsonb;
alter table public.tracking_sync_attempts add constraint tracking_sync_attempts_support_context_check
  check (support_context is null or (jsonb_typeof(support_context) = 'object' and octet_length(support_context::text) <= 4096));

create table public.tracking_support_cases (
  id uuid primary key default gen_random_uuid(),
  tracking_number text not null unique,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  configured_carrier text,
  detection_carrier text,
  detection_confidence text,
  detection_candidates text[] not null default '{}',
  reasons text[] not null default '{}',
  app_version text,
  seen_count bigint not null default 0,
  fallback_count bigint not null default 0,
  last_provider text,
  last_source_carrier text,
  last_outcome text,
  last_error_type text,
  fix_status text not null default 'open',
  fix_reference text,
  fixed_at timestamptz,
  notes text,
  direct_verified_at timestamptz,
  direct_verified_carrier text,
  constraint tracking_support_cases_number_check check (
    length(tracking_number) between 4 and 40 and tracking_number ~ '[0-9]'
    and tracking_number ~ '^([A-Z0-9]+|[0-9]{4}/[0-9]{8})$'
  ),
  constraint tracking_support_cases_times_check check (first_seen <= last_seen),
  constraint tracking_support_cases_counts_check check (seen_count >= 0 and fallback_count between 0 and seen_count),
  constraint tracking_support_cases_lists_check check (cardinality(reasons) <= 16 and cardinality(detection_candidates) <= 64),
  constraint tracking_support_cases_fix_check check (
    fix_status in ('open', 'fixed', 'verified', 'ignored')
    and (fix_status not in ('fixed', 'verified') or fixed_at is not null)
    and (fix_status <> 'verified' or (direct_verified_at is not null and direct_verified_at >= fixed_at))
    and (fix_reference is null or length(fix_reference) <= 500)
    and (notes is null or length(notes) <= 4000)
  ),
  constraint tracking_support_cases_labels_check check (
    (configured_carrier is null or length(configured_carrier) between 1 and 100)
    and (detection_carrier is null or length(detection_carrier) between 1 and 100)
    and (detection_confidence is null or detection_confidence in ('high', 'low', 'none'))
    and (app_version is null or length(app_version) between 1 and 100)
    and (last_provider is null or length(last_provider) between 1 and 100)
    and (last_source_carrier is null or length(last_source_carrier) between 1 and 100)
    and (last_outcome is null or length(last_outcome) between 1 and 100)
    and (last_error_type is null or length(last_error_type) between 1 and 100)
    and (direct_verified_carrier is null or length(direct_verified_carrier) between 1 and 100)
  )
);

-- A stable key makes replay and backfill idempotent after the audit is pruned.
create table public.tracking_support_observations (
  observation_key text primary key check (length(observation_key) between 1 and 160),
  case_id uuid not null references public.tracking_support_cases(id) on delete cascade,
  observed_at timestamptz not null,
  completed boolean not null default false
);
create index tracking_support_cases_status_seen_idx on public.tracking_support_cases(fix_status, last_seen desc);
create index tracking_support_observations_case_idx on public.tracking_support_observations(case_id);
alter table public.tracking_support_cases enable row level security;
alter table public.tracking_support_observations enable row level security;
revoke all on public.tracking_support_cases, public.tracking_support_observations from public, anon, authenticated;
grant select, insert, update, delete on public.tracking_support_cases, public.tracking_support_observations to service_role;

create function public.record_tracking_support_observation(
  p_tracking_number text,
  p_context jsonb,
  p_evidence jsonb,
  p_observed_at timestamptz,
  p_observation_key text
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  number text := upper(regexp_replace(p_tracking_number, '[[:space:].-]', '', 'g'));
  context jsonb := coalesce(p_context, '{}');
  evidence jsonb := coalesce(p_evidence, '{}');
  reason_tags text[];
  candidate_ids text[];
  support_case public.tracking_support_cases;
  observation public.tracking_support_observations;
  inserted_count integer;
  completed boolean;
  provider text;
  source text;
  direct_progress boolean;
begin
  if number is null or length(number) not between 4 and 40 or number !~ '[0-9]'
      or number !~ '^([A-Z0-9]+|[0-9]{4}/[0-9]{8})$'
      or p_observed_at is null or not isfinite(p_observed_at)
      or p_observation_key is null or length(p_observation_key) not between 1 and 160
      or jsonb_typeof(context) <> 'object' or octet_length(context::text) > 4096
      or jsonb_typeof(evidence) <> 'object' or octet_length(evidence::text) > 4096 then
    raise exception 'Invalid tracking support observation' using errcode = '22023';
  end if;
  if (context ? 'reasons' and jsonb_typeof(context->'reasons') <> 'array')
      or (context ? 'detection_candidates' and jsonb_typeof(context->'detection_candidates') <> 'array') then
    raise exception 'Invalid tracking support context' using errcode = '22023';
  end if;
  reason_tags := array(
    select distinct tag from (
      select jsonb_array_elements_text(coalesce(context->'reasons', '[]')) as tag
      union all select nullif(evidence->>'support_gap_reason', '')
    ) as supplied where tag is not null order by tag
  );
  candidate_ids := array(select distinct jsonb_array_elements_text(coalesce(context->'detection_candidates', '[]')));
  if cardinality(reason_tags) > 16 or exists(select 1 from unnest(reason_tags) as tag where tag !~ '^[a-z][a-z0-9_]{0,63}$')
      or cardinality(candidate_ids) > 64 or exists(select 1 from unnest(candidate_ids) as id where length(id) not between 1 and 100) then
    raise exception 'Invalid tracking support tags' using errcode = '22023';
  end if;
  completed := nullif(evidence->>'outcome', '') is not null and evidence->>'outcome' <> 'running';
  if completed and evidence->>'outcome' in ('superseded', 'abandoned', 'interrupted') then return null; end if;
  select * into support_case from public.tracking_support_cases where tracking_number = number for update;
  if not found then
    if cardinality(reason_tags) = 0 then return null; end if;
    insert into public.tracking_support_cases(tracking_number, first_seen, last_seen)
    values(number, p_observed_at, p_observed_at) on conflict(tracking_number) do nothing;
    select * into strict support_case from public.tracking_support_cases where tracking_number = number for update;
  end if;
  insert into public.tracking_support_observations(observation_key, case_id, observed_at)
  values(p_observation_key, support_case.id, p_observed_at) on conflict(observation_key) do nothing;
  get diagnostics inserted_count = row_count;
  select * into strict observation from public.tracking_support_observations where observation_key = p_observation_key for update;
  if observation.case_id <> support_case.id then
    raise exception 'Tracking support observation key reused' using errcode = '22023';
  end if;
  if observation.completed then return support_case.id; end if;
  provider := nullif(left(evidence->>'support_provider', 100), '');
  source := nullif(left(evidence->>'source_carrier', 100), '');
  direct_progress := completed and evidence->>'outcome' = 'updated'
    and evidence->>'support_direct_progress' = 'true' and provider is null
    and source is not null and source not in ('unknown', 'intl-post')
    and upper(regexp_replace(evidence->>'support_lookup_number', '[[:space:].-]', '', 'g')) = number;
  update public.tracking_support_cases set
    first_seen = least(first_seen, p_observed_at),
    last_seen = greatest(last_seen, p_observed_at),
    configured_carrier = case when p_observed_at >= last_seen and context ? 'configured_carrier' then nullif(left(context->>'configured_carrier', 100), '') else configured_carrier end,
    detection_carrier = case when p_observed_at >= last_seen and context ? 'detection_carrier' then nullif(left(context->>'detection_carrier', 100), '') else detection_carrier end,
    detection_confidence = case when p_observed_at >= last_seen and context ? 'detection_confidence' then nullif(context->>'detection_confidence', '') else detection_confidence end,
    detection_candidates = case when p_observed_at >= last_seen and context ? 'detection_candidates' then candidate_ids else detection_candidates end,
    app_version = case when p_observed_at >= last_seen and context ? 'app_version' then nullif(left(context->>'app_version', 100), '') else app_version end,
    reasons = array(select distinct tag from unnest(reasons || reason_tags) as tag order by tag),
    seen_count = seen_count + inserted_count,
    fallback_count = fallback_count + case when completed and provider is not null then 1 else 0 end,
    last_provider = case when completed and p_observed_at >= last_seen then provider else last_provider end,
    last_source_carrier = case when completed and p_observed_at >= last_seen then source else last_source_carrier end,
    last_outcome = case when completed and p_observed_at >= last_seen then nullif(left(evidence->>'outcome', 100), '') else last_outcome end,
    last_error_type = case when completed and p_observed_at >= last_seen then nullif(left(evidence->>'error_type', 100), '') else last_error_type end,
    direct_verified_at = case when direct_progress then greatest(direct_verified_at, p_observed_at) else direct_verified_at end,
    direct_verified_carrier = case when direct_progress and (direct_verified_at is null or p_observed_at >= direct_verified_at) then source else direct_verified_carrier end,
    fix_status = case when direct_progress and fix_status = 'fixed' and p_observed_at >= fixed_at then 'verified' else fix_status end
  where id = support_case.id;
  if completed then
    update public.tracking_support_observations set completed = true where observation_key = p_observation_key;
  end if;
  return support_case.id;
end;
$$;
revoke all on function public.record_tracking_support_observation(text,jsonb,jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function public.record_tracking_support_observation(text,jsonb,jsonb,timestamptz,text) to service_role;

create function public.capture_tracking_support_case()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  number text;
  details jsonb := '{}';
  evidence jsonb := '{}';
begin
  if TG_OP = 'UPDATE' and (OLD.outcome <> 'running' or NEW.outcome = 'running'
      or NEW.outcome in ('superseded', 'abandoned', 'interrupted')) then return NEW; end if;
  number := NEW.support_context->>'tracking_number';
  if number is null then select tracking_number into number from public.packages where id = NEW.package_id; end if;
  if TG_OP = 'UPDATE' then
    select step.details into details from public.tracking_sync_steps as step
    where attempt_id = NEW.id and step.step = 'complete' order by sequence desc limit 1;
    evidence := coalesce(details, '{}') || jsonb_build_object(
      'outcome', NEW.outcome, 'source_carrier', NEW.source_carrier, 'error_type', NEW.error_type);
  end if;
  if number is not null then
    perform public.record_tracking_support_observation(number,
      jsonb_build_object('configured_carrier', NEW.configured_carrier) || coalesce(NEW.support_context, '{}'), evidence,
      case when TG_OP = 'INSERT' then NEW.started_at else NEW.completed_at end, 'attempt:' || NEW.id::text);
  end if;
  return NEW;
end;
$$;
revoke all on function public.capture_tracking_support_case() from public, anon, authenticated;
create trigger capture_tracking_support_case after insert or update of outcome on public.tracking_sync_attempts
  for each row execute function public.capture_tracking_support_case();

-- Preserve the lease fence while recording the same context as manual checks.
create or replace function public.start_leased_sync_attempt(p_attempt_id uuid, p_job_id uuid, p_worker_id text, p_values jsonb)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  perform 1 from public.sync_jobs where id = p_job_id and state = 'running' and locked_by = p_worker_id
    and lease_until > clock_timestamp()
    and (kind = 'scheduled' or package_id = (p_values->>'package_id')::uuid) for share;
  if not found then return false; end if;
  insert into public.tracking_sync_attempts(id, job_id, package_id, trigger, configured_carrier, previous_stage, started_at, support_context)
  values(p_attempt_id, p_job_id, (p_values->>'package_id')::uuid, p_values->>'trigger',
    p_values->>'configured_carrier', p_values->>'previous_stage', (p_values->>'started_at')::timestamptz,
    nullif(p_values->'support_context', 'null'::jsonb));
  return true;
end;
$$;
revoke all on function public.start_leased_sync_attempt(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.start_leased_sync_attempt(uuid,uuid,text,jsonb) to service_role;
notify pgrst, 'reload schema';
