\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11111111-aaaa-4111-8111-111111111111','sender@example.test'),
 ('22222222-bbbb-4222-8222-222222222222','receiver@example.test'),
 ('33333333-cccc-4333-8333-333333333333','stranger@example.test');
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth,locale,subscribed_at) values
 ('44444444-dddd-4444-8444-444444444444','11111111-aaaa-4111-8111-111111111111','https://fcm.googleapis.com/fcm/send/friendship-test','p','a','fr',now()-interval '1 hour');
insert into public.native_push_devices(id,user_id,token,environment,locale,subscribed_at) values
 ('55555555-eeee-4555-8555-555555555555','11111111-aaaa-4111-8111-111111111111',repeat('c7',32),'development','de',now()-interval '1 hour');

do $$
declare sender uuid := '11111111-aaaa-4111-8111-111111111111'; receiver uuid := '22222222-bbbb-4222-8222-222222222222'; stranger uuid := '33333333-cccc-4333-8333-333333333333';
 code text; sender_card uuid; receiver_card uuid; result jsonb; claimed jsonb; count_claimed integer;
begin
 if has_table_privilege('authenticated','public.friendship_updates','select')
    or has_table_privilege('anon','public.friendship_push_deliveries','select')
    or has_function_privilege('authenticated','public.claim_friendship_push(boolean,boolean,integer)','execute')
    or has_function_privilege('authenticated','public.finish_friendship_push(uuid,uuid,boolean)','execute')
    or has_function_privilege('anon','public.friends_activity()','execute') then raise exception 'Receipt privilege leak'; end if;
 perform set_config('request.jwt.claim.sub',sender::text,true);
 sender_card := (public.friends_action('save_profile','Paul',true,false)#>>'{snapshot,ownCard,id}')::uuid;
 code := public.friends_action('create_invite')->>'inviteCode';
 perform set_config('request.jwt.claim.sub',receiver::text,true);
 receiver_card := (public.friends_action('save_profile','Alex',false,false)#>>'{snapshot,ownCard,id}')::uuid;
 result := public.friends_action('accept_invite',p_code=>code);
 if result#>>'{acceptedFriend,id}' <> sender_card::text or result#>>'{acceptedFriend,nickname}' <> 'Paul' then raise exception 'Acceptance omitted the received card'; end if;
 if public.friends_activity() <> '{"updates":[]}' then raise exception 'Receiver notified about own action'; end if;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 if public.friends_activity() <> '{"updates":[]}' then raise exception 'Stranger saw acceptance'; end if;
 perform public.friends_action('acknowledge_friend',p_friend_id=>receiver_card);
 perform set_config('request.jwt.claim.sub',sender::text,true);
 if public.friends_activity() <> jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('friendId',receiver_card,'nickname','Alex'))) then raise exception 'Sender receipt leaked fields or was lost'; end if;
 if (select count(*) from public.friendship_push_deliveries) <> 2 then raise exception 'Missing per-device notifications'; end if;
 -- Re-sharing with an existing friend does not create a second notice.
 code := public.friends_action('create_invite')->>'inviteCode';
 perform set_config('request.jwt.claim.sub',receiver::text,true);
 perform public.friends_action('accept_invite',p_code=>code);
 if (select count(*) from public.friendship_updates) <> 1 or (select count(*) from public.friendship_push_deliveries) <> 2 then raise exception 'Duplicate friendship notification'; end if;
 -- Existing notification quiet hours defer both channels.
 insert into public.notification_preferences(user_id,quiet_hours_start,quiet_hours_end,timezone)
   values(sender,(now() at time zone 'UTC' - interval '1 minute')::time,(now() at time zone 'UTC' + interval '1 minute')::time,'UTC');
 if exists(select 1 from public.claim_friendship_push(true,true)) then raise exception 'Quiet hours ignored'; end if;
 update public.notification_preferences set quiet_hours_start=null,quiet_hours_end=null where user_id=sender;
 select value into claimed from public.claim_friendship_push(false,true) value;
 if claimed->>'device_id' <> '55555555-eeee-4555-8555-555555555555' or claimed->>'nickname' <> 'Alex' or claimed->>'locale' <> 'de' then raise exception 'Wrong native receipt'; end if;
 if exists(select 1 from public.claim_friendship_push(false,true)) then raise exception 'Lease did not prevent duplicate dispatch'; end if;
 perform public.finish_friendship_push((claimed->>'id')::uuid,gen_random_uuid(),true);
 if exists(select 1 from public.friendship_push_deliveries where sent_at is not null) then raise exception 'Stale lease acknowledged receipt'; end if;
 perform public.finish_friendship_push((claimed->>'id')::uuid,(claimed->>'lease_token')::uuid,false);
 if exists(select 1 from public.claim_friendship_push(false,true)) then raise exception 'Retry ignored backoff'; end if;
 update public.friendship_push_deliveries set next_attempt_at=now() where device_id is not null;
 select value into claimed from public.claim_friendship_push(false,true) value;
 perform public.finish_friendship_push((claimed->>'id')::uuid,(claimed->>'lease_token')::uuid,true);
 if exists(select 1 from public.claim_friendship_push(false,true)) then raise exception 'Delivered receipt sent twice'; end if;
 -- A signed-out or reassigned destination is no longer eligible.
 update public.push_subscriptions set disabled_at=now() where user_id=sender;
 if exists(select 1 from public.claim_friendship_push(true,false)) then raise exception 'Disabled browser notified'; end if;
 update public.push_subscriptions set disabled_at=null,user_id=stranger;
 if exists(select 1 from public.claim_friendship_push(true,false)) then raise exception 'Another account received nickname'; end if;
 update public.push_subscriptions set user_id=sender;
 -- Reading the in-app notice cancels any still-pending push.
 perform set_config('request.jwt.claim.sub',sender::text,true);
 perform public.friends_action('acknowledge_friend',p_friend_id=>receiver_card);
 if public.friends_activity() <> '{"updates":[]}' or exists(select 1 from public.claim_friendship_push(true,false)) then raise exception 'Read receipt replayed'; end if;
 perform public.friends_action('remove_friend',p_friend_id=>receiver_card);
 if exists(select 1 from public.friendship_updates) or exists(select 1 from public.friendship_push_deliveries) then raise exception 'Removed friendship retained receipts'; end if;
end $$;
rollback;
select 'Friendship receipts, privacy, quiet hours, leases, and retries passed' as result;
