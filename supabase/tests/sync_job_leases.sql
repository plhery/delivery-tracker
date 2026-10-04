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

begin;
-- A parcel deleted or reconfigured under its check has nothing left to save:
-- the worker's write answers false instead of a lost lease.
delete from public.sync_jobs;
insert into public.packages (id, user_id, tracking_number, carrier) values
  ('97000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'LEASETEST5678', 'ups'),
  ('97000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'LEASETEST9012', 'ups');

do $$
declare
  owner_id constant uuid := '10000000-0000-0000-0000-000000000001';
  deleted_id constant uuid := '97000000-0000-0000-0000-000000000005';
  changed_id constant uuid := '97000000-0000-0000-0000-000000000006';
  owner_key constant text := repeat('c', 64);
  leased_write constant regprocedure := 'public.apply_leased_tracking_sync(uuid,text,uuid,uuid,jsonb,jsonb,text[])';
  job_id uuid;
  generation uuid;
  lookup jsonb;
  one_off_id uuid;
begin
  if (select prosecdef or proconfig is distinct from array['search_path=pg_catalog'] from pg_proc where oid = leased_write)
      or not has_function_privilege('service_role', leased_write, 'execute') then
    raise exception 'leased write lost its configuration';
  end if;

  -- Deleted by its account: the job goes with the parcel.
  insert into public.sync_jobs (user_id, package_id, kind, dedupe_key)
  values (owner_id, deleted_id, 'package', 'package:' || deleted_id) returning id into job_id;
  perform public.claim_sync_job('worker-a', 900);
  select tracking_generation into generation from public.packages where id = deleted_id;
  if not public.apply_leased_tracking_sync(job_id, 'worker-a', deleted_id, generation, '{"sync_status":"syncing"}') then
    raise exception 'live owner could not persist';
  end if;
  delete from public.packages where id = deleted_id;
  if exists (select 1 from public.sync_jobs where id = job_id) then raise exception 'deleted parcel kept its job'; end if;
  if public.apply_leased_tracking_sync(job_id, 'worker-a', deleted_id, generation, '{"sync_status":"waiting"}') then
    raise exception 'deleted parcel was written';
  end if;
  if public.finish_sync_job(job_id, 'worker-a', '{}') then raise exception 'deleted job was finished'; end if;

  -- A lookup forgotten with its key.
  lookup := public.create_one_off_parcel('LEASETEST3456', 'unknown', null, null, owner_key);
  one_off_id := (lookup#>>'{package,id}')::uuid;
  insert into public.sync_jobs (package_id, kind, dedupe_key)
  values (one_off_id, 'package', 'package:' || one_off_id) returning id into job_id;
  perform public.claim_sync_job('worker-a', 900);
  select tracking_generation into generation from public.packages where id = one_off_id;
  if not public.apply_leased_tracking_sync(job_id, 'worker-a', one_off_id, generation, '{"sync_status":"syncing"}') then
    raise exception 'live owner could not persist a lookup';
  end if;
  if public.forget_parcel_link(lookup#>>'{link,id}', owner_key) <> '{"links":1,"packages":1}' then
    raise exception 'lookup was not forgotten';
  end if;
  if public.apply_leased_tracking_sync(job_id, 'worker-a', one_off_id, generation, '{"sync_status":"waiting"}') then
    raise exception 'forgotten lookup was written';
  end if;
  if public.finish_sync_job(job_id, 'worker-a', '{}') then raise exception 'forgotten job was finished'; end if;

  -- A carrier change ends the job and renews the generation.
  insert into public.sync_jobs (user_id, package_id, kind, dedupe_key)
  values (owner_id, changed_id, 'package', 'package:' || changed_id) returning id into job_id;
  perform public.claim_sync_job('worker-a', 900);
  select tracking_generation into generation from public.packages where id = changed_id;
  if not public.apply_leased_tracking_sync(job_id, 'worker-a', changed_id, generation, '{"sync_status":"syncing"}') then
    raise exception 'live owner could not persist before the carrier change';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if not public.change_owned_package_carrier(changed_id, 'fedex') then raise exception 'carrier was not changed'; end if;
  if not exists (select 1 from public.sync_jobs
    where id = job_id and state = 'failed' and last_error like 'Superseded%') then
    raise exception 'carrier change did not end the job as superseded';
  end if;
  if public.apply_leased_tracking_sync(job_id, 'worker-a', changed_id, generation, '{"sync_status":"waiting"}') then
    raise exception 'reconfigured parcel was written';
  end if;
  if (select sync_status from public.packages where id = changed_id) <> 'pending' then
    raise exception 'stale check changed the reconfigured parcel';
  end if;
  -- The parcel as it now stands is still fenced from the ended job.
  select tracking_generation into generation from public.packages where id = changed_id;
  begin
    perform public.apply_leased_tracking_sync(job_id, 'worker-a', changed_id, generation, '{"sync_status":"ok"}');
    raise exception 'ended job could persist';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
rollback;

begin;
delete from public.sync_jobs;
insert into public.packages (id, user_id, tracking_number, carrier)
values ('97000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'HANDOFFTEST1234', 'ups');
insert into public.sync_jobs(id, kind, dedupe_key)
values ('97000000-0000-0000-0000-000000000003', 'scheduled', 'scheduled');
do $$
declare
  job_id uuid := '97000000-0000-0000-0000-000000000003';
  stored_check_in jsonb := '{"checkInId":"test-check-in","monitorSlug":"delivery-tracker-sync-daytime","startedAt":1}';
  audit_id uuid;
  n integer;
begin
  if has_function_privilege('authenticated', 'public.release_sync_job(uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.set_sync_job_check_in(uuid,text,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.start_leased_sync_attempt(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'handoff functions exposed';
  end if;
  for n in 1..5 loop
    perform public.claim_sync_job('old-worker');
    if (select lease_until > clock_timestamp() + interval '91 seconds' from public.sync_jobs where id=job_id) then
      raise exception 'crash recovery still takes 15 minutes';
    end if;
    if public.release_sync_job(job_id, 'other-worker') then raise exception 'nonowner released'; end if;
    if not public.set_sync_job_check_in(job_id, 'old-worker', stored_check_in) then raise exception 'check-in not saved'; end if;
    audit_id := gen_random_uuid();
    if not public.start_leased_sync_attempt(audit_id, job_id, 'old-worker', jsonb_build_object(
      'package_id','97000000-0000-0000-0000-000000000004', 'trigger','scheduled',
      'configured_carrier','ups', 'previous_stage','pending', 'started_at',clock_timestamp())) then
      raise exception 'owner could not start audit';
    end if;
    if not public.release_sync_job(job_id, 'old-worker') then raise exception 'handoff failed'; end if;
    if (select outcome from public.tracking_sync_attempts where id=audit_id) <> 'interrupted' then
      raise exception 'shutdown left a running audit';
    end if;
    if (select attempts from public.sync_jobs where id=job_id) <> 0 then raise exception 'deploy consumed a retry'; end if;
  end loop;
  perform public.claim_sync_job('replacement');
  if (select check_in from public.sync_jobs where id=job_id) <> stored_check_in then raise exception 'check-in lost'; end if;
  if public.release_sync_job(job_id, 'old-worker') or public.renew_sync_job_lease(job_id, 'old-worker')
    or public.finish_sync_job(job_id, 'old-worker', '{}') then raise exception 'old worker retained ownership'; end if;
  if public.start_leased_sync_attempt(gen_random_uuid(), job_id, 'old-worker', '{}') then
    raise exception 'old worker created a late audit';
  end if;
  if not public.finish_sync_job(job_id, 'replacement', '{"updated":1}') then raise exception 'replacement failed'; end if;
end;
$$;
rollback;
