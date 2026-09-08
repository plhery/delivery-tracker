\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values
 ('a9999999-9999-4999-8999-999999999999', 'outcomes-sender@example.test'),
 ('b9999999-9999-4999-8999-999999999999', 'outcomes-recipient@example.test'),
 ('c9999999-9999-4999-8999-999999999999', 'outcomes-stranger@example.test');
do $$
declare
 sender uuid := 'a9999999-9999-4999-8999-999999999999'; recipient uuid := 'b9999999-9999-4999-8999-999999999999'; stranger uuid := 'c9999999-9999-4999-8999-999999999999';
 invitation jsonb; result jsonb; key text; candidate text; sender_card uuid; fresh text;
begin
 perform set_config('request.jwt.claim.sub', sender::text, true);
 perform public.friends_action('save_profile', 'Sender', false, false);
 invitation := public.friends_action('create_invite'); key := invitation->>'previewId';
 fresh := public.friends_action('create_invite')->>'previewId';
 perform set_config('request.jwt.claim.sub', recipient::text, true);
 perform public.friends_action('save_profile', 'Recipient', false, false);
 result := public.friends_action('accept_invite', p_code=>key);
 sender_card := (result#>>'{acceptedFriend,id}')::uuid;
 if result ? 'invitationState' then raise exception 'New acceptance did not create friendship'; end if;
 foreach candidate in array array[key, invitation->>'inviteCode'] loop
   result := public.friends_action('preview_invite', p_code=>candidate);
   if result <> '{"previewNickname":"Sender","invitationState":"already_accepted"}'::jsonb then raise exception 'Wrong consumed outcome or private data leak: %', result; end if;
   result := public.friends_action('accept_invite', p_code=>candidate);
   if result->>'invitationState' <> 'already_accepted' or result ? 'acceptedFriend' then raise exception 'Duplicate acceptance celebrated'; end if;
 end loop;
 if exists(select 1 from public.friend_invites where preview_id=key) then raise exception 'Consumed invitation is publicly previewable'; end if;
 if public.friends_action('preview_invite', p_code=>fresh) <> '{"previewNickname":"Sender","invitationState":"already_friends"}'::jsonb then raise exception 'Existing friendship not recognized'; end if;
 if public.friends_action('accept_invite', p_code=>fresh)->>'invitationState' <> 'already_friends' then raise exception 'Existing friendship accepted again'; end if;
 if not exists(select 1 from public.friend_invites where preview_id=fresh) then raise exception 'Existing friend consumed a fresh link'; end if;
 if (select count(*) from public.friendship_updates where recipient_id=sender and friend_user_id=recipient) <> 1 then raise exception 'Duplicate friendship notice'; end if;
 perform set_config('request.jwt.claim.sub', stranger::text, true);
 begin
   perform public.friends_action('preview_invite', p_code=>key);
   raise exception 'Consumed receipt disclosed to another account';
 exception when no_data_found then null; end;
 perform public.friends_action('save_profile', 'Stranger', false, false);
 begin
   perform public.friends_action('accept_invite', p_code=>key);
   raise exception 'Consumed link accepted by another account';
 exception when no_data_found then null; end;
 -- A fresh invitation remains usable for its intended new recipient.
 result := public.friends_action('accept_invite', p_code=>fresh);
 if not (result ? 'acceptedFriend') then raise exception 'Fresh link could not be used'; end if;
 perform set_config('request.jwt.claim.sub', recipient::text, true);
 perform public.friends_action('remove_friend', p_friend_id=>sender_card);
 result := public.friends_action('accept_invite', p_code=>key);
 if result->>'invitationState' <> 'already_accepted' or result#>'{snapshot,friends}' <> '[]' then raise exception 'Receipt recreated removed friendship'; end if;
 perform public.friends_action('disable');
 if exists(select 1 from private.friend_invitation_receipts where recipient_id=recipient) then raise exception 'Disabled profile retained receipt'; end if;
 delete from auth.users where id=sender;
 if exists(select 1 from private.friend_invitation_receipts where sender_id=sender) then raise exception 'Deleted sender retained receipts'; end if;
 if has_table_privilege('anon','private.friend_invitation_receipts','select') or has_table_privilege('authenticated','private.friend_invitation_receipts','select') then raise exception 'Private receipt table exposed'; end if;
end $$;
rollback;
select 'Invitation outcomes, single use, audience, removal and privacy passed' as result;
