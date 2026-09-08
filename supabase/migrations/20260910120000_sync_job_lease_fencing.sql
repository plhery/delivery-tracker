-- Lease renewal and writes use the database clock, never a worker's clock.
create function public.renew_sync_job_lease(p_job_id uuid, p_worker_id text, p_lease_seconds integer default 900)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  update public.sync_jobs set lease_until = clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
  where id = p_job_id and state = 'running' and locked_by = p_worker_id and lease_until > clock_timestamp();
  return found;
end;
$$;

create function public.finish_sync_job(p_job_id uuid, p_worker_id text, p_result jsonb default null, p_error text default null)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  update public.sync_jobs set state = case when p_error is null then 'succeeded' else 'failed' end,
    completed_at = clock_timestamp(), lease_until = null, locked_by = null, dedupe_key = null,
    result = p_result, last_error = left(p_error, 500)
  where id = p_job_id and state = 'running' and locked_by = p_worker_id and lease_until > clock_timestamp();
  return found;
end;
$$;

-- Serialize package writes with job reclamation. A paused worker cannot save
-- an old carrier response after another worker has claimed the expired job.
create function public.apply_leased_tracking_sync(
  p_job_id uuid, p_worker_id text, p_package_id uuid, p_tracking_generation uuid,
  p_values jsonb, p_events jsonb default '[]'::jsonb, p_delete_descriptions text[] default '{}'::text[]
)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  perform 1 from public.sync_jobs where id = p_job_id and state = 'running'
    and locked_by = p_worker_id and lease_until > clock_timestamp()
    and (kind = 'scheduled' or package_id = p_package_id) for update;
  if not found then raise exception 'Synchronization job lease was lost' using errcode = '55000'; end if;
  return public.apply_tracking_sync(p_package_id, p_tracking_generation, p_values, p_events, p_delete_descriptions);
end;
$$;

revoke all on function public.renew_sync_job_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finish_sync_job(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_leased_tracking_sync(uuid, text, uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.renew_sync_job_lease(uuid, text, integer) to service_role;
grant execute on function public.finish_sync_job(uuid, text, jsonb, text) to service_role;
grant execute on function public.apply_leased_tracking_sync(uuid, text, uuid, uuid, jsonb, jsonb, text[]) to service_role;
notify pgrst, 'reload schema';
