-- Append carrier timestamp precision without changing existing queue filters.
-- Some installations have ordinary push but have not enabled ActivityKit yet.
-- Only extend queues that exist; do not enable another notification channel.

do $$
declare
  queue text;
  definition text;
begin
  perform set_config('search_path', '', true);
  foreach queue in array array[
    'pending_push_notifications', 'pending_native_push_notifications', 'pending_live_activity_events'
  ] loop
    if to_regclass('public.' || queue) is null then continue; end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = queue and column_name = 'event_has_time'
    ) then continue; end if;

    definition := regexp_replace(pg_get_viewdef(to_regclass('public.' || queue), true), ';\s*$', '');
    execute format($view$
      create or replace view public.%I with (security_invoker = true) as
      select pending.*,
        (
          source_event.raw_data -> 'observed_without_provider_timestamp' is distinct from 'true'::jsonb
          and coalesce(source_event.raw_data ->> 'time' ~ '[T ][0-9]{2}:[0-9]{2}', false)
        ) as event_has_time
      from (%s) as pending
      join public.tracking_events as source_event on source_event.id = pending.event_id
    $view$, queue, definition);
    execute format('revoke all on public.%I from public, anon, authenticated', queue);
    execute format('grant select on public.%I to service_role', queue);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
