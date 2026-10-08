-- A check whose carrier answered with the progress already saved was recorded
-- as `updated`, like one that stored a new scan, so most `updated` checks
-- stored nothing. Such a check is now `unchanged`, and `events_new` counts the
-- scans a check stored for the first time (null before this migration). The
-- server running during the rollout writes neither, so this applies before it
-- is replaced. Where an earlier check counts as having seen the parcel, an
-- unchanged one still does.

alter table public.tracking_sync_attempts drop constraint tracking_sync_attempts_outcome_check;
alter table public.tracking_sync_attempts add constraint tracking_sync_attempts_outcome_check
  check (outcome in ('running', 'updated', 'unchanged', 'waiting', 'error', 'unsupported', 'abandoned', 'superseded', 'interrupted'));
alter table public.tracking_sync_attempts add column events_new integer
  constraint tracking_sync_attempts_events_new_check check (events_new between 0 and 10000);
comment on column public.tracking_sync_attempts.events_new is
  'Scans the check stored for the first time; a scan rewritten in place does not count. Null for checks recorded before the column.';

-- Also stores the count of new scans; a payload without one leaves it null.
create or replace function public.complete_tracking_sync_attempt(
  p_attempt_id uuid,
  p_values jsonb,
  p_steps jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if jsonb_typeof(p_values) <> 'object' or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Invalid tracking sync audit payload' using errcode = '22023';
  end if;

  insert into public.tracking_sync_steps (
    attempt_id,
    sequence,
    step,
    status,
    occurred_at,
    duration_ms,
    details,
    error_type
  )
  select
    p_attempt_id,
    row.sequence,
    row.step,
    row.status,
    coalesce(row.occurred_at, now()),
    row.duration_ms,
    coalesce(row.details, '{}'::jsonb),
    row.error_type
  from jsonb_to_recordset(p_steps) as row(
    sequence smallint,
    step text,
    status text,
    occurred_at timestamptz,
    duration_ms integer,
    details jsonb,
    error_type text
  )
  on conflict (attempt_id, sequence) do update set
    step = excluded.step,
    status = excluded.status,
    occurred_at = excluded.occurred_at,
    duration_ms = excluded.duration_ms,
    details = excluded.details,
    error_type = excluded.error_type;

  update public.tracking_sync_attempts
  set
    source_carrier = case
      when p_values ? 'source_carrier' then nullif(p_values ->> 'source_carrier', '')
      else source_carrier
    end,
    outcome = p_values ->> 'outcome',
    current_step = 'complete',
    provider_status = nullif(p_values ->> 'provider_status', ''),
    reported_stage = nullif(p_values ->> 'reported_stage', ''),
    selected_stage = nullif(p_values ->> 'selected_stage', ''),
    status_text = nullif(left(p_values ->> 'status_text', 500), ''),
    events_received = coalesce((p_values ->> 'events_received')::integer, 0),
    events_normalized = coalesce((p_values ->> 'events_normalized')::integer, 0),
    events_new = (p_values ->> 'events_new')::integer,
    anomaly_codes = coalesce(
      array(select jsonb_array_elements_text(p_values -> 'anomaly_codes')),
      '{}'::text[]
    ),
    error_type = nullif(p_values ->> 'error_type', ''),
    completed_at = coalesce((p_values ->> 'completed_at')::timestamptz, now()),
    duration_ms = (p_values ->> 'duration_ms')::integer
  where id = p_attempt_id
    and outcome = 'running';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

-- Appends its columns: a replaced view keeps the ones it had, in order.
create or replace view public.tracking_sync_health_24h
with (security_invoker = true)
as
select
  configured_carrier,
  count(*) as attempts,
  count(*) filter (where outcome = 'updated') as updated,
  count(*) filter (where outcome = 'waiting') as waiting,
  count(*) filter (where outcome = 'error') as errors,
  count(*) filter (where outcome = 'unsupported') as unsupported,
  count(*) filter (where outcome = 'abandoned') as abandoned,
  count(*) filter (where cardinality(anomaly_codes) > 0) as anomalous,
  round(
    100.0 * count(*) filter (where outcome in ('error', 'abandoned'))
      / nullif(count(*), 0),
    2
  ) as error_percent,
  max(started_at) as last_attempt_at,
  count(*) filter (where outcome = 'unchanged') as unchanged,
  sum(events_new) as events_new
from public.tracking_sync_attempts
where started_at >= now() - interval '24 hours'
group by configured_carrier;

-- An earlier check that saw the parcel on another stage, whether or not it stored a scan.
create or replace function public.claim_delivery_emails(
  p_limit integer,
  p_per_account integer,
  p_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_limit is null or p_limit < 1
      or p_per_account is null or p_per_account < 0
      or p_per_day is null or p_per_day < 0 then
    raise exception 'Invalid delivery email allowance' using errcode = '22023';
  end if;

  -- One claim at a time: both allowances count what the other servers claimed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delivery-emails', 0));

  with scan as (
    select
      package.id as package_id,
      package.user_id,
      event.id as event_id,
      event.occurred_at,
      event.created_at as stored_at,
      preference.timezone,
      coalesce(package.owned_since, package.created_at) as joined_at,
      case
        when event.raw_data -> 'observed_without_provider_timestamp' = 'true'::jsonb then 'none'
        when event.raw_data ->> 'time' ~ '[T ][0-9]{2}:[0-9]{2}' then 'timed'
        when event.raw_data ->> 'time' ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[./][0-9]{2}[./][0-9]{4})' then 'date'
        else 'none'
      end as delivered_time
    from public.notification_preferences as preference
    join public.packages as package on package.user_id = preference.user_id
    join public.tracking_events as event on event.package_id = package.id
    where preference.email_on_delivery
      and not package.email_muted
      and package.archived_at is null
      and package.current_stage = 'delivered'
      and event.stage = 'delivered'
      and (event.provider_event_id is null or event.provider_event_id not like 'app:%')
      and event.created_at > preference.email_enabled_at
      and event.created_at > now() - interval '24 hours'
  ),
  candidate as (
    select distinct on (scan.package_id) scan.*, previous.id as previous_id
    from scan
    left join public.delivery_emails as previous on previous.package_id = scan.package_id
    where scan.stored_at > scan.joined_at
      and case
        when scan.delivered_time = 'timed' then scan.occurred_at > scan.joined_at
        -- A day is stored as its first moment, so it may read up to a day early.
        else scan.occurred_at > scan.joined_at - interval '1 day' and exists (
          select 1 from public.tracking_sync_attempts as earlier
          where earlier.package_id = scan.package_id
            and earlier.outcome in ('updated', 'unchanged')
            and earlier.selected_stage is distinct from 'delivered'
            and earlier.started_at >= scan.joined_at
            and earlier.completed_at < scan.stored_at
        )
      end
      and coalesce(scan.occurred_at >= (
        select max(other.occurred_at)
        from public.tracking_events as other
        where other.package_id = scan.package_id
          and (other.provider_event_id is null or other.provider_event_id not like 'app:%')
          and other.occurred_at <= now()
      ) - interval '1 hour', true)
      and (previous.id is null or (
        previous.status = 'failed'
        and previous.attempts < 3
        and previous.claimed_at <= now() - case when previous.attempts < 2 then interval '15 minutes' else interval '1 hour' end
      ))
      and not exists (
        select 1
        from public.delivery_emails as told
        join public.tracking_events as told_scan on told_scan.id = told.event_id
        where told_scan.package_id = scan.package_id
          and told.package_id is distinct from scan.package_id
      )
    order by scan.package_id, scan.occurred_at desc, scan.stored_at desc, scan.event_id
  ),
  batch as (
    select limited.*,
      row_number() over (partition by limited.user_id order by limited.stored_at, limited.event_id) as account_position
    from (
      select * from candidate order by candidate.stored_at, candidate.event_id limit least(p_limit, 100)
    ) as limited
  ),
  used as (
    select email.user_id, count(*) as emails
    from public.delivery_emails as email
    where email.status in ('claimed', 'sent')
      and coalesce(email.sent_at, email.claimed_at) > now() - interval '24 hours'
    group by email.user_id
  ),
  judged as (
    select batch.*, batch.account_position + coalesce(used.emails, 0) <= p_per_account as account_allows
    from batch
    left join used on used.user_id = batch.user_id
  ),
  decided as (
    select judged.*,
      case
        when not judged.account_allows then 'account_cap'
        when (select coalesce(sum(used.emails), 0) from used)
          + count(*) filter (where judged.account_allows) over (order by judged.stored_at, judged.event_id)
          > p_per_day then 'service_cap'
      end as skipped
    from judged
  ),
  inserted as (
    insert into public.delivery_emails (user_id, package_id, event_id, status, reason, attempts)
    select decided.user_id, decided.package_id, decided.event_id,
      case when decided.skipped is null then 'claimed' else 'skipped' end,
      decided.skipped,
      case when decided.skipped is null then 1 else 0 end
    from decided
    where decided.previous_id is null
    on conflict do nothing
    returning id, package_id, status
  ),
  retried as (
    update public.delivery_emails as email
    set status = case when decided.skipped is null then 'claimed' else 'skipped' end,
      reason = decided.skipped,
      attempts = email.attempts + case when decided.skipped is null then 1 else 0 end,
      event_id = decided.event_id,
      claimed_at = now()
    from decided
    where email.id = decided.previous_id
      and email.status = 'failed'
      and email.attempts < 3
    returning email.id, email.package_id, email.status
  )
  select jsonb_build_object(
    'send', coalesce(jsonb_agg(jsonb_build_object(
      'id', written.id,
      'package_id', decided.package_id,
      'user_id', decided.user_id,
      'event_id', decided.event_id,
      'timezone', decided.timezone,
      'delivered_time', decided.delivered_time
    ) order by decided.stored_at, decided.event_id) filter (where written.status = 'claimed'), '[]'::jsonb),
    'account_cap', count(*) filter (where written.status = 'skipped' and decided.skipped = 'account_cap'),
    'service_cap', count(*) filter (where written.status = 'skipped' and decided.skipped = 'service_cap')
  )
  into claimed
  from (select * from inserted union all select * from retried) as written
  join decided on decided.package_id = written.package_id;

  return claimed;
end;
$$;

-- A direct lookup that answered with progress verifies a fix, whether or not the progress was new.
create or replace function public.record_tracking_support_observation(
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
  if number is null or length(number) not between 4 and 40 or (number !~ '[0-9]' and number !~ '^[A-Z]{6,}$')
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
  direct_progress := completed and evidence->>'outcome' in ('updated', 'unchanged')
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

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008060000_unchanged_tracking_checks') on conflict do nothing;
