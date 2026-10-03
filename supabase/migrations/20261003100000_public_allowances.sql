-- More day counters without an account.
--
-- A lookup is also counted against its client's IPv6 /48: one customer can
-- hold 65,536 of the /64s that were each counted as a client. Asking carriers
-- which of them knows a number gets day counters of its own, per client and
-- overall: it had only a limit per minute, kept in memory.
--
-- A bucket says what it counts:
--   <hash>             one client's lookups
--   network:<hash>     the lookups of one IPv6 /48
--   global             every lookup
--   detection:<hash>   the numbers one client had carriers asked about
--   detection          every such number
--
-- Apply this before deploying the server that counts them. The server before
-- it keeps working: it calls claim_public_lookup with its first three
-- arguments and reads the summary's first four values.

alter table public.public_lookup_usage
  drop constraint public_lookup_usage_bucket_format,
  add constraint public_lookup_usage_bucket_format
    check (bucket ~ '^(global|detection|((network|detection):)?[0-9a-f]{64})$');

comment on table public.public_lookup_usage is
  'Lookups and carrier detections without an account per day (UTC), by hashed client address or network and overall. Kept for seven days.';

-- Counts one use for today (UTC) against the caller's bucket, its network's
-- when it has one, and every caller together, unless one of the allowances is
-- used up: then nothing is counted and `scope` names it. `overall` is how
-- many every caller together has used. The rows are locked in the same order
-- by every caller.
drop function public.claim_public_lookup(text, integer, integer);

create function public.claim_public_lookup(
  p_bucket text,
  p_limit integer,
  p_global_limit integer,
  p_global_bucket text default 'global',
  p_network_bucket text default null,
  p_network_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today constant date := (now() at time zone 'UTC')::date;
  used integer;
  used_by_network integer;
  used_overall integer;
begin
  if p_bucket is null or p_bucket !~ '^(detection:)?[0-9a-f]{64}$'
      or p_limit is null or p_limit < 0
      or p_global_bucket is null or p_global_bucket not in ('global', 'detection')
      or p_global_limit is null or p_global_limit < 0
      or (p_network_bucket is not null and (
        p_network_bucket !~ '^network:[0-9a-f]{64}$' or p_network_limit is null or p_network_limit < 0
      )) then
    raise exception 'Invalid lookup allowance' using errcode = '22023';
  end if;

  delete from public.public_lookup_usage where day < today - 7;

  insert into public.public_lookup_usage (bucket, day)
  select counted.bucket, today
  from unnest(array[p_global_bucket, p_network_bucket, p_bucket]) as counted(bucket)
  where counted.bucket is not null
  on conflict do nothing;
  select count into used_overall from public.public_lookup_usage
  where bucket = p_global_bucket and day = today for update;
  if p_network_bucket is not null then
    select count into used_by_network from public.public_lookup_usage
    where bucket = p_network_bucket and day = today for update;
  end if;
  select count into used from public.public_lookup_usage
  where bucket = p_bucket and day = today for update;

  if used >= p_limit then
    return jsonb_build_object('allowed', false, 'scope', 'bucket', 'remaining', 0, 'overall', used_overall);
  end if;
  if used_by_network >= p_network_limit then
    return jsonb_build_object('allowed', false, 'scope', 'network', 'remaining', p_limit - used, 'overall', used_overall);
  end if;
  if used_overall >= p_global_limit then
    return jsonb_build_object('allowed', false, 'scope', 'global', 'remaining', p_limit - used, 'overall', used_overall);
  end if;

  update public.public_lookup_usage set count = count + 1
  where day = today and bucket in (p_global_bucket, p_network_bucket, p_bucket);
  return jsonb_build_object('allowed', true, 'scope', null, 'remaining', p_limit - used - 1, 'overall', used_overall + 1);
end;
$$;

-- How many of yesterday's buckets (UTC) of one kind were used, and their
-- median, 90th percentile and maximum.
create function private.public_usage_stats(p_buckets text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'buckets', count(*),
    'p50', coalesce(percentile_disc(0.5) within group (order by usage.count), 0),
    'p90', coalesce(percentile_disc(0.9) within group (order by usage.count), 0),
    'max', coalesce(max(usage.count), 0)
  )
  from public.public_lookup_usage as usage
  where usage.day = (now() at time zone 'UTC')::date - 1
    and usage.bucket ~ p_buckets
    and usage.count > 0;
$$;

-- Yesterday's lookups per client (UTC), and under `detection` the numbers
-- per client that carriers were asked about, for tuning the daily allowances.
create or replace function public.public_lookup_usage_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.public_usage_stats('^[0-9a-f]{64}$')
    || jsonb_build_object('detection', private.public_usage_stats('^detection:[0-9a-f]{64}$'));
$$;

revoke all on function private.public_usage_stats(text) from public, anon, authenticated;
revoke all on function public.claim_public_lookup(text, integer, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_public_lookup(text, integer, integer, text, text, integer) to service_role;

notify pgrst, 'reload schema';
