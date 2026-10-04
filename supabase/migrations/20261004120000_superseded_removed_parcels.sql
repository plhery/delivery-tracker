-- Deleting a parcel deletes its job, and a carrier change ends it, so the
-- worker's write no longer finds the job it holds. With the parcel gone or
-- reconfigured there is nothing left to save, which is what false already
-- means. A lease lost while the parcel stands still raises.
create or replace function public.apply_leased_tracking_sync(
  p_job_id uuid, p_worker_id text, p_package_id uuid, p_tracking_generation uuid,
  p_values jsonb, p_events jsonb default '[]'::jsonb, p_delete_descriptions text[] default '{}'::text[]
)
returns boolean language plpgsql set search_path = pg_catalog as $$
begin
  perform 1 from public.sync_jobs where id = p_job_id and state = 'running'
    and locked_by = p_worker_id and lease_until > clock_timestamp()
    and (kind = 'scheduled' or package_id = p_package_id) for update;
  if not found then
    if not exists (select 1 from public.packages
      where id = p_package_id and tracking_generation = p_tracking_generation) then
      return false;
    end if;
    raise exception 'Synchronization job lease was lost' using errcode = '55000';
  end if;
  return public.apply_tracking_sync(p_package_id, p_tracking_generation, p_values, p_events, p_delete_descriptions);
end;
$$;

revoke all on function public.apply_leased_tracking_sync(uuid, text, uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.apply_leased_tracking_sync(uuid, text, uuid, uuid, jsonb, jsonb, text[]) to service_role;
notify pgrst, 'reload schema';
