\set ON_ERROR_STOP on
begin;
-- Keep the claim deterministic and roll everything back after the assertions.
delete from public.sync_jobs;
insert into public.packages (id, user_id, tracking_number, carrier)
values ('97000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LEASETEST1234', 'ups');
insert into public.sync_jobs (id, user_id, package_id, kind, dedupe_key)
values ('97000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001', 'package', 'lease-test');

do $$
declare
  job_id uuid := '97000000-0000-0000-0000-000000000002';
  parcel_id uuid := '97000000-0000-0000-0000-000000000001';
  generation uuid;
  old_deadline timestamptz;
begin
  if has_function_privilege('authenticated', 'public.renew_sync_job_lease(uuid,text,integer)', 'execute')
    or has_function_privilege('anon', 'public.apply_leased_tracking_sync(uuid,text,uuid,uuid,jsonb,jsonb,text[])', 'execute')
    or has_function_privilege('authenticated', 'public.finish_sync_job(uuid,text,jsonb,text)', 'execute') then
    raise exception 'lease functions are exposed to users';
  end if;
  perform public.claim_sync_job('worker-a', 30);
  select lease_until into old_deadline from public.sync_jobs where id = job_id;
  if not public.renew_sync_job_lease(job_id, 'worker-a', 900) then
    raise exception 'live owner could not renew';
  end if;
  if (select lease_until from public.sync_jobs where id = job_id) <= old_deadline then
    raise exception 'renewal did not extend the deadline';
  end if;
  if public.renew_sync_job_lease(job_id, 'worker-b', 900) then raise exception 'nonowner renewed lease'; end if;
  select tracking_generation into generation from public.packages where id = parcel_id;
  if not public.apply_leased_tracking_sync(job_id, 'worker-a', parcel_id, generation, '{"sync_status":"syncing"}') then
    raise exception 'live owner could not persist';
  end if;
  update public.sync_jobs set lease_until = clock_timestamp() - interval '1 minute' where id = job_id;
  if public.renew_sync_job_lease(job_id, 'worker-a', 900) or public.finish_sync_job(job_id, 'worker-a', '{}') then
    raise exception 'expired owner could renew or finish';
  end if;
  begin
    perform public.apply_leased_tracking_sync(job_id, 'worker-a', parcel_id, generation,
      '{"current_stage":"delivered"}', '[{"provider_event_id":"stale","stage":"delivered","description":"Stale response","occurred_at":"2026-09-08T12:00:00Z"}]');
    raise exception 'expired owner could persist';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform public.claim_sync_job('worker-b', 900);
  begin
    perform public.apply_leased_tracking_sync(job_id, 'worker-a', parcel_id, generation, '{"current_stage":"delivered"}');
    raise exception 'replaced owner could persist';
  exception when object_not_in_prerequisite_state then null;
  end;
  if exists(select 1 from public.tracking_events where package_id = parcel_id and provider_event_id = 'stale') then
    raise exception 'expired job inserted events';
  end if;
  if public.finish_sync_job(job_id, 'worker-a', '{}') then raise exception 'replaced owner finished new job'; end if;
  if not public.apply_leased_tracking_sync(job_id, 'worker-b', parcel_id, generation, '{"sync_status":"ok"}')
    or not public.finish_sync_job(job_id, 'worker-b', '{"updated":1}') then
    raise exception 'new owner could not finish';
  end if;
end;
$$;
rollback;
