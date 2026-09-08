\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values
 ('a1111111-1111-4111-8111-111111111111','friends-a@example.test'),
 ('b2222222-2222-4222-8222-222222222222','friends-b@example.test'),
 ('c3333333-3333-4333-8333-333333333333','friends-c@example.test');
insert into public.packages(id,user_id,tracking_number,label,carrier) values
 ('d4444444-4444-4444-8444-444444444444','a1111111-1111-4111-8111-111111111111','PRIVATEPARCEL123','PRIVATE_CONTENT','ups');
insert into public.tracking_events(package_id,stage,description,location,occurred_at) values
 ('d4444444-4444-4444-8444-444444444444','accepted','PRIVATE_SENDER','PRIVATE_ADDRESS',now()-interval '25 hours'),
 ('d4444444-4444-4444-8444-444444444444','delivered','PRIVATE_RECIPIENT','PRIVATE_POSTCODE',now()-interval '1 hour');

do $$
begin
 if has_table_privilege('authenticated','public.friend_profiles','select') or has_table_privilege('anon','public.friend_connections','select')
    or has_table_privilege('authenticated','public.friend_invites','select')
    or has_function_privilege('anon','public.friends_snapshot()','execute')
    or has_function_privilege('authenticated','private.friend_card(uuid)','execute') then raise exception 'Friends privilege leak'; end if;
end $$;

set local role authenticated;
do $$
declare a uuid := 'a1111111-1111-4111-8111-111111111111'; b uuid := 'b2222222-2222-4222-8222-222222222222'; c uuid := 'c3333333-3333-4333-8333-333333333333';
 code text; old_code text; view jsonb; friend_id uuid;
begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 view := public.friends_snapshot();
 if view->'profile' <> 'null' or view->'friends' <> '[]' then raise exception 'Friends enrolled a user automatically'; end if;
 begin
   perform public.friends_action('save_profile',U&'A\202Ename',true,false);
   raise exception 'Invisible direction control accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.friends_action('save_profile',U&'\00A0\2000',true,false);
   raise exception 'Whitespace-only nickname accepted';
 exception when invalid_parameter_value then null; end;
 perform public.friends_action('save_profile','A friend',true,false);
 view := public.friends_snapshot();
 if view#>>'{ownCard,stats,deliveredCount}' <> '1' or view#>>'{ownCard,stats,averageDays}' <> '1'
    or view#>'{ownCard,stats,stamps}' <> '["first","express"]' or view#>'{ownCard,arrivedThisWeek}' <> 'null' then raise exception 'Incorrect private summary: %',view; end if;
 code := public.friends_action('create_invite')->>'inviteCode';
 begin
   perform public.friends_action('accept_invite',p_code=>code);
   raise exception 'Self invite accepted';
 exception when sqlstate 'P0004' then null; end;
 begin
   perform public.friends_action('preview_invite',p_code=>code);
   raise exception 'Self invitation preview was not distinguished';
 exception when sqlstate 'P0004' then null; end;
 if public.friends_snapshot()->'friends' <> '[]' or public.friends_activity() <> '{"updates":[]}' then
   raise exception 'Self invitation created a connection or a receipt';
 end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 view := public.friends_action('preview_invite',p_code=>code);
 if view <> '{"previewNickname":"A friend"}' then raise exception 'Preview leaked stats: %',view; end if;
 begin
   perform public.friends_action('accept_invite',p_code=>code);
   raise exception 'Non-consenting account became a friend';
 exception when invalid_parameter_value then null; end;
 view := public.friends_action('save_profile','B friend',false,false)->'snapshot';
 if view->'profile' is distinct from '{"nickname":"B friend","shareStats":false,"shareArrival":false}'::jsonb
    or view->'friends' <> '[]' then raise exception 'Profile setup did not return the saved choices: %',view; end if;
 view := public.friends_action('accept_invite',p_code=>code)->'snapshot';
 if jsonb_array_length(view->'friends') <> 1 or view#>>'{friends,0,nickname}' <> 'A friend' then raise exception 'Friend not connected'; end if;
 if view::text like '%PRIVATE_%' or view::text like '%tracking%' or view::text like '%location%' or view::text like '%email%' or view::text like '%'||a::text||'%' then raise exception 'Private parcel/account data leaked'; end if;
 friend_id := (view#>>'{friends,0,id}')::uuid;
 if exists(select 1 from public.packages where user_id=a) or exists(select 1 from public.tracking_events where package_id='d4444444-4444-4444-8444-444444444444') then raise exception 'Friendship bypassed parcel RLS'; end if;
  if public.friends_action('accept_invite', p_code=>code)->>'invitationState' <> 'already_accepted' then raise exception 'Consumed invitation was not recognized'; end if;
 perform set_config('request.jwt.claim.sub',c::text,true);
 if public.friends_snapshot()->'friends' <> '[]' then raise exception 'Stranger saw friends'; end if;
 perform public.friends_action('remove_friend',p_friend_id=>friend_id);
 perform set_config('request.jwt.claim.sub',b::text,true);
 if jsonb_array_length(public.friends_snapshot()->'friends') <> 1 then raise exception 'Stranger removed another connection'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 if public.friends_snapshot()#>'{friends,0,stats}' <> 'null' then raise exception 'Opted-out stats leaked'; end if;
 perform public.friends_action('save_profile','A friend',false,true);
 perform set_config('request.jwt.claim.sub',b::text,true);
 view := public.friends_snapshot();
 if view#>'{friends,0,stats}' <> 'null' then raise exception 'Privacy preference ignored'; end if;
 if jsonb_typeof(view#>'{friends,0,arrivedThisWeek}') <> 'boolean' then raise exception 'Arrival signal is not coarse'; end if;
 perform public.friends_action('remove_friend',p_friend_id=>friend_id);
 if public.friends_snapshot()->'friends' <> '[]' then raise exception 'Removal did not revoke access'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 if public.friends_snapshot()->'friends' <> '[]' then raise exception 'Removal was not mutual'; end if;
 old_code := public.friends_action('create_invite')->>'inviteCode';
 code := public.friends_action('create_invite')->>'inviteCode';
 perform set_config('request.jwt.claim.sub',b::text,true);
 if public.friends_action('preview_invite',p_code=>old_code)->>'previewNickname' <> 'A friend' then
   raise exception 'Creating another invitation invalidated a previous link';
 end if;
 perform public.friends_action('accept_invite',p_code=>code);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.friends_action('create_invite');
 perform public.friends_action('disable');
 if public.friends_snapshot()->'profile' <> 'null' then raise exception 'Disable retained profile'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if public.friends_snapshot()->'friends' <> '[]' then raise exception 'Disable retained friendships'; end if;
 code := public.friends_action('create_invite')->>'inviteCode';
 perform set_config('request.jwt.claim.sub',a::text,true);
 view := public.friends_action('save_profile','A again',false,false)->'snapshot';
 if view#>>'{profile,nickname}' <> 'A again' or view#>'{profile,shareStats}' <> 'false'
    or view#>'{profile,shareArrival}' <> 'false' then raise exception 'Friends could not be enabled again'; end if;
 view := public.friends_action('accept_invite',p_code=>code)->'snapshot';
 if jsonb_array_length(view->'friends') <> 1 or view#>>'{friends,0,nickname}' <> 'B friend'
    or view#>'{ownCard,stats}' <> 'null' then raise exception 'Re-enabled user could not accept privately: %',view; end if;
end $$;
reset role;

do $$
declare a uuid := 'a1111111-1111-4111-8111-111111111111'; b uuid := 'b2222222-2222-4222-8222-222222222222'; code text;
begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.friends_action('save_profile','A',true,false);
 code := public.friends_action('create_invite')->>'inviteCode';
 if exists(select 1 from public.friend_invites where code_hash=code) then raise exception 'Raw invite stored'; end if;
 update public.friend_invites set expires_at=now()-interval '1 second' where user_id=a;
 perform set_config('request.jwt.claim.sub',b::text,true);
 begin perform public.friends_action('preview_invite',p_code=>code); raise exception 'Expired code accepted'; exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 code := public.friends_action('create_invite')->>'inviteCode';
 perform public.friends_action('revoke_invite');
 perform set_config('request.jwt.claim.sub',b::text,true);
 begin perform public.friends_action('preview_invite',p_code=>code); raise exception 'Revoked code accepted'; exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.friends_action('create_invite');
 delete from auth.users where id=a;
 if exists(select 1 from public.friend_profiles where user_id=a) or exists(select 1 from public.friend_invites where user_id=a) then raise exception 'Account deletion retained social data'; end if;
end $$;
rollback;
select 'Friends privacy and lifecycle assertions passed' as result;
