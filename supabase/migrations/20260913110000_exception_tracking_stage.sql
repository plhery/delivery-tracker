-- A carrier can report a problem that is neither a missed delivery attempt nor
-- a return: a damaged parcel, an address problem, a hold, a loss, a refusal or
-- a customs case that needs the recipient to act. Those updates used to be
-- squeezed into failed_attempt, which promised a delivery round that never
-- happened. The exception stage records them as what they are: the parcel keeps
-- its position on the happy path, stays non-terminal, and keeps refreshing.

alter table public.tracking_events
  drop constraint if exists tracking_events_stage_check,
  add constraint tracking_events_stage_check check (
    stage in (
      'pending', 'registered', 'accepted', 'in_transit', 'out_for_delivery',
      'delivered', 'customs', 'failed_attempt', 'ready_for_pickup', 'returned',
      'exception'
    )
  );

alter table public.packages
  drop constraint if exists packages_current_stage_check,
  add constraint packages_current_stage_check check (
    current_stage in (
      'pending', 'registered', 'accepted', 'in_transit', 'out_for_delivery',
      'delivered', 'customs', 'failed_attempt', 'ready_for_pickup', 'returned',
      'exception'
    )
  );

-- Alerts for a problem are as useful as alerts for a missed attempt, so the
-- stage is selectable and on by default for everyone who never chose.
alter table public.notification_preferences
  alter column enabled_stages set default array[
    'registered', 'accepted', 'in_transit', 'customs', 'exception',
    'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered',
    'returned'
  ]::text[],
  drop constraint if exists notification_preferences_stages_check,
  add constraint notification_preferences_stages_check check (
    cardinality(enabled_stages) between 1 and 10
    and enabled_stages <@ array[
      'registered', 'accepted', 'in_transit', 'customs', 'exception',
      'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered',
      'returned'
    ]::text[]
  );

create or replace function public.set_owned_notification_preferences(
  p_enabled_stages text[],
  p_quiet_hours_start time default null,
  p_quiet_hours_end time default null,
  p_timezone text default 'Europe/Zurich'
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  saved public.notification_preferences;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if p_enabled_stages is null
      or cardinality(p_enabled_stages) not between 1 and 10
      or not p_enabled_stages <@ array[
        'registered', 'accepted', 'in_transit', 'customs', 'exception',
        'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered',
        'returned'
      ]::text[]
      or cardinality(p_enabled_stages) <> cardinality(array(
        select distinct stage from unnest(p_enabled_stages) as stage
      )) then
    raise exception 'Invalid notification stages' using errcode = '22023';
  end if;
  if (p_quiet_hours_start is null) <> (p_quiet_hours_end is null)
      or p_quiet_hours_start = p_quiet_hours_end then
    raise exception 'Invalid quiet hours' using errcode = '22023';
  end if;
  if p_timezone is null
      or char_length(p_timezone) not between 1 and 64
      or not exists (
        select 1 from pg_catalog.pg_timezone_names where name = p_timezone
      ) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;

  insert into public.notification_preferences (
    user_id,
    enabled_stages,
    quiet_hours_start,
    quiet_hours_end,
    timezone,
    updated_at
  ) values (
    actor_id,
    p_enabled_stages,
    p_quiet_hours_start,
    p_quiet_hours_end,
    p_timezone,
    now()
  )
  on conflict (user_id) do update set
    enabled_stages = excluded.enabled_stages,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    timezone = excluded.timezone,
    updated_at = excluded.updated_at
  returning * into saved;

  return saved;
end;
$$;

-- The queue views carry the same default inline, for subscribers who never
-- saved a preference row. Rewrite only that literal so each installation keeps
-- its own ownership, filters, quiet hours and timestamp precision.
do $$
declare
  queue text;
  definition text;
  updated text;
begin
  perform set_config('search_path', '', true);
  foreach queue in array array[
    'pending_push_notifications', 'pending_native_push_notifications', 'pending_live_activity_events'
  ] loop
    if to_regclass('public.' || queue) is null then continue; end if;
    definition := regexp_replace(pg_get_viewdef(to_regclass('public.' || queue), true), ';\s*$', '');
    updated := replace(
      definition,
      '''returned''::text]',
      '''returned''::text, ''exception''::text]'
    );
    if updated = definition then continue; end if;
    execute format(
      'create or replace view public.%I with (security_invoker = true) as %s', queue, updated
    );
    execute format('revoke all on public.%I from public, anon, authenticated', queue);
    execute format('grant select on public.%I to service_role', queue);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
