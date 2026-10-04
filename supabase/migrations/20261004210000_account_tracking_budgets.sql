create table private.account_tracking_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('lookup', 'detection')),
  count integer not null check (count > 0),
  primary key (user_id, day, kind)
);
alter table private.account_tracking_usage enable row level security;
revoke all on private.account_tracking_usage from public, anon, authenticated;

-- Claim before work starts. All instances and concurrent requests share the limit.
create function public.claim_account_tracking(p_user_id uuid, p_kind text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today constant date := (now() at time zone 'UTC')::date;
  claimed integer;
begin
  if p_user_id is null or p_kind is null or p_kind not in ('lookup', 'detection')
      or p_limit is null or p_limit < 0 then
    raise exception 'Invalid tracking allowance' using errcode = '22023';
  end if;
  delete from private.account_tracking_usage where day < today - 7;
  if p_limit = 0 then return false; end if;
  insert into private.account_tracking_usage as usage (user_id, day, kind, count)
  values (p_user_id, today, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = usage.count + 1
  where usage.count < p_limit
  returning count into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_account_tracking(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_account_tracking(uuid, text, integer) to service_role;
notify pgrst, 'reload schema';
