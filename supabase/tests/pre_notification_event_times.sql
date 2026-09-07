\set ON_ERROR_STOP on
begin;

-- Exercise the upgrade on installations that have not enabled ActivityKit.
\ir ../migrations/20260907150000_notification_event_times.sql
-- Reapplying this additive migration must not duplicate the new column.
\ir ../migrations/20260907150000_notification_event_times.sql

do $$
begin
  if to_regclass('public.pending_live_activity_events') is not null then
    raise exception 'notification time upgrade enabled ActivityKit';
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('pending_push_notifications', 'pending_native_push_notifications')
      and column_name = 'event_has_time' and data_type = 'boolean'
  ) <> 2 then
    raise exception 'legacy notification queues did not gain timestamp precision';
  end if;
end;
$$;

rollback;
select 'legacy notification time upgrade assertions passed' as result;
