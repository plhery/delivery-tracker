-- Browser alerts follow the language selected on that device.
alter table public.push_subscriptions
  add column locale text not null default 'en'
  check (locale in ('en', 'de', 'fr', 'it'));

-- Preserve the installed queue's ownership, filters, quiet hours, and precision.
do $$
declare
  definition text;
begin
  perform set_config('search_path', '', true);
  definition := regexp_replace(pg_get_viewdef('public.pending_push_notifications'::regclass, true), ';\s*$', '');
  execute format($view$
    create or replace view public.pending_push_notifications with (security_invoker = true) as
    select pending.*, subscription.locale
    from (%s) as pending
    join public.push_subscriptions as subscription on subscription.id = pending.subscription_id
  $view$, definition);
end;
$$;
revoke all on public.pending_push_notifications from public, anon, authenticated;
grant select on public.pending_push_notifications to service_role;
notify pgrst, 'reload schema';
