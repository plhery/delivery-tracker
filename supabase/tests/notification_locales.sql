\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('98000000-0000-0000-0000-000000000001', 'notification-locales@example.invalid');
insert into auth.sessions (id, user_id)
values ('98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');
set local role service_role;

insert into public.packages (id, user_id, tracking_number, carrier)
values ('98000000-0000-0000-0000-000000000002',
  '98000000-0000-0000-0000-000000000001', '1Z999AA10123456784', 'ups');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/notification-locales', 'test-key', 'test-auth');
insert into public.native_push_devices (id, user_id, token, environment)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000001',
  repeat('96', 32), 'development');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000004',
  repeat('95', 32), 'development');
insert into public.live_activity_update_tokens (id, device_id, package_id, activity_id, token, environment)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-000000000002', 'locale-test', repeat('94', 32), 'development');

do $$
declare
  subscription_table text;
  language text;
  stored_language text;
begin
  foreach subscription_table in array array[
    'push_subscriptions', 'native_push_devices', 'live_activity_devices', 'live_activity_update_tokens'
  ] loop
    foreach language in array array['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'] loop
      execute format('update public.%I set locale = $1 where id = $2 returning locale', subscription_table)
        into stored_language using language, '98000000-0000-0000-0000-000000000003'::uuid;
      if stored_language is distinct from language then
        raise exception '% did not preserve locale %', subscription_table, language;
      end if;
    end loop;
    begin
      execute format('update public.%I set locale = ''nl'' where id = $1', subscription_table)
        using '98000000-0000-0000-0000-000000000003'::uuid;
      raise exception '% accepted an unsupported locale', subscription_table;
    exception when check_violation then null;
    end;
  end loop;
end;
$$;

rollback;
select 'notification locale assertions passed' as result;
