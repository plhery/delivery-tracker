-- Backward-compatible rollout: apply before deploying the new worker.
alter table public.sync_jobs add column check_in jsonb;
alter table public.tracking_sync_attempts drop constraint tracking_sync_attempts_outcome_check;
alter table public.tracking_sync_attempts add constraint tracking_sync_attempts_outcome_check
  check (outcome in ('running', 'updated', 'waiting', 'error', 'unsupported', 'abandoned', 'superseded', 'interrupted'));

-- Ownership and the database clock fence every handoff. A late old process
-- cannot release, renew, finish or save data into a replacement's job.
create function public.release_sync_job(p_job_id uuid, p_worker_id text)
returns boolean language plpgsql set search_path = pg_catalog set lock_timeout = '2s' as $$
begin
  update public.sync_jobs set state = 'queued', locked_by = null, lease_until = null,
    run_after = clock_timestamp(), attempts = greatest(0, attempts - 1)
  where id = p_job_id and state = 'running' and locked_by = p_worker_id and lease_until > clock_timestamp();
  if not found then return false; end if;
  update public.tracking_sync_attempts set outcome = 'interrupted', current_step = 'complete',
    completed_at = clock_timestamp(), error_type = 'WorkerShutdown',
    duration_ms = least(2147483647, greatest(0, extract(epoch from (clock_timestamp() - started_at)) * 1000))::integer
  where job_id = p_job_id and outcome = 'running';
  return true;
end;
$$;

-- Keep the Sentry check-in attached to the durable job across deployments.
create function public.set_sync_job_check_in(p_job_id uuid, p_worker_id text, p_check_in jsonb)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  if jsonb_typeof(p_check_in) <> 'object' or octet_length(p_check_in::text) > 1024 then
    raise exception 'Invalid sync check-in';
  end if;
  update public.sync_jobs set check_in = p_check_in
  where id = p_job_id and state = 'running' and locked_by = p_worker_id and lease_until > clock_timestamp();
  return found;
end;
$$;

-- Starting an audit races shutdown too; serialize it with the job handoff.
create function public.start_leased_sync_attempt(p_attempt_id uuid, p_job_id uuid, p_worker_id text, p_values jsonb)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  perform 1 from public.sync_jobs where id = p_job_id and state = 'running' and locked_by = p_worker_id
    and lease_until > clock_timestamp()
    and (kind = 'scheduled' or package_id = (p_values->>'package_id')::uuid) for share;
  if not found then return false; end if;
  insert into public.tracking_sync_attempts(id, job_id, package_id, trigger, configured_carrier, previous_stage, started_at)
  values(p_attempt_id, p_job_id, (p_values->>'package_id')::uuid, p_values->>'trigger',
    p_values->>'configured_carrier', p_values->>'previous_stage', (p_values->>'started_at')::timestamptz);
  return true;
end;
$$;

create or replace function public.claim_sync_job(p_worker_id text, p_lease_seconds integer default 90)
returns setof public.sync_jobs language plpgsql security definer set search_path = '' as $$
declare
  claimed public.sync_jobs;
  claim_time timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker_id), '') is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'Invalid worker lease' using errcode = '22023';
  end if;
  delete from public.sync_jobs where state in ('succeeded', 'failed') and completed_at < claim_time - interval '30 days';
  update public.sync_jobs set state = 'failed', completed_at = claim_time, lease_until = null,
    locked_by = null, dedupe_key = null, last_error = 'The sync worker stopped before completing this job.'
  where state = 'running' and lease_until < claim_time and attempts >= 3;
  with candidate as (
    select id from public.sync_jobs where (state = 'queued' and run_after <= claim_time)
      or (state = 'running' and lease_until < claim_time and attempts < 3)
    order by priority desc, run_after, requested_at for update skip locked limit 1
  )
  update public.sync_jobs j set state = 'running', started_at = coalesce(j.started_at, claim_time),
    completed_at = null, lease_until = claim_time + make_interval(secs => p_lease_seconds),
    locked_by = p_worker_id, attempts = j.attempts + 1, last_error = null
  from candidate where j.id = candidate.id returning j.* into claimed;
  if not found then return; end if;
  -- Finish the previous process's ledger immediately, not 30 minutes later.
  update public.tracking_sync_attempts set outcome = 'abandoned', current_step = 'complete',
    completed_at = clock_timestamp(), error_type = 'WorkerLeaseExpired',
    duration_ms = least(2147483647, greatest(0, extract(epoch from (clock_timestamp() - started_at)) * 1000))::integer
  where job_id = claimed.id and outcome = 'running';
  return next claimed;
end;
$$;

revoke all on function public.release_sync_job(uuid,text), public.set_sync_job_check_in(uuid,text,jsonb),
  public.start_leased_sync_attempt(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.release_sync_job(uuid,text), public.set_sync_job_check_in(uuid,text,jsonb),
  public.start_leased_sync_attempt(uuid,uuid,text,jsonb) to service_role;
notify pgrst, 'reload schema';
