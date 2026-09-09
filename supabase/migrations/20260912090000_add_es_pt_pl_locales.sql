-- Keep browser, APNs and Live Activity subscriptions in the selected app language.
-- Apply before deploying clients that can register es, pt or pl subscriptions.
alter table public.push_subscriptions
  drop constraint push_subscriptions_locale_check,
  add constraint push_subscriptions_locale_check
    check (locale in ('en', 'de', 'fr', 'it', 'es', 'pt', 'pl'));
alter table public.native_push_devices
  drop constraint native_push_devices_locale_check,
  add constraint native_push_devices_locale_check
    check (locale in ('en', 'de', 'fr', 'it', 'es', 'pt', 'pl'));
alter table public.live_activity_devices
  drop constraint live_activity_devices_locale_check,
  add constraint live_activity_devices_locale_check
    check (locale in ('en', 'de', 'fr', 'it', 'es', 'pt', 'pl'));
alter table public.live_activity_update_tokens
  drop constraint live_activity_update_tokens_locale_check,
  add constraint live_activity_update_tokens_locale_check
    check (locale in ('en', 'de', 'fr', 'it', 'es', 'pt', 'pl'));
notify pgrst, 'reload schema';
