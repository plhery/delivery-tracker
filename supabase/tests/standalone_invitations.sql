\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email, is_anonymous) values
  ('a7777777-7777-4777-8777-777777777777', 'standalone-owner@example.test', false),
  ('b7777777-7777-4777-8777-777777777777', 'standalone-recipient@example.test', false),
  ('c7777777-7777-4777-8777-777777777777', 'standalone-other@example.test', false),
  ('d7777777-7777-4777-8777-777777777777', null, true);

do $$
declare
  sender uuid := 'a7777777-7777-4777-8777-777777777777';
  recipient uuid := 'b7777777-7777-4777-8777-777777777777';
  other_id uuid := 'c7777777-7777-4777-8777-777777777777';
  result jsonb; key text; legacy text; earlier text; newer text; candidate text;
begin
  perform set_config('request.jwt.claim.sub', sender::text, true);
  perform public.friends_action('save_profile', 'Sender', false, false);
  earlier := public.friends_action('create_invite')->>'previewId';
  result := public.friends_action('create_invite');
  key := result->>'previewId'; legacy := result->>'inviteCode';
  newer := public.friends_action('create_invite')->>'previewId';
  if key !~ '^[A-Za-z0-9_-]{16}$' or key in (earlier, newer) then raise exception 'Invalid standalone key'; end if;
  if (select expires_at from public.friend_invites where preview_id=key) <> now()+interval '7 days' then raise exception 'Expiry changed'; end if;
  begin
    perform public.friends_action('accept_invite', p_code=>key);
    raise exception 'Self invitation was accepted';
  exception when sqlstate 'P0004' then null; end;

  foreach candidate in array array['', 'd7777777-7777-4777-8777-777777777777'] loop
    perform set_config('request.jwt.claim.sub', candidate, true);
    begin
      perform public.friends_action('accept_invite', p_code=>key);
      raise exception 'A permanent signed-in account was not required';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub', recipient::text, true);
  if public.friends_action('preview_invite', p_code=>key) <> '{"previewNickname":"Sender"}'::jsonb then raise exception 'Preview leaked data'; end if;
  if public.friends_action('preview_invite', p_code=>legacy) <> '{"previewNickname":"Sender"}'::jsonb then raise exception 'Legacy link failed'; end if;
  if not exists(select 1 from public.friend_invites where preview_id=key) then raise exception 'Preview consumed the invitation'; end if;
  begin
    perform public.friends_action('accept_invite', p_code=>key);
    raise exception 'Profile consent was not required';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.friends_action('accept_invite', p_code=>encode(sha256(convert_to(legacy,'UTF8')),'hex'));
    raise exception 'Public legacy hash was accepted';
  exception when no_data_found then null; end;
  perform public.friends_action('save_profile', 'Recipient', false, false);
  result := public.friends_action('accept_invite', p_code=>key);
  if result#>>'{acceptedFriend,nickname}' <> 'Sender' or jsonb_array_length(result#>'{snapshot,friends}') <> 1 then raise exception 'Short link did not create friendship'; end if;
  foreach candidate in array array[key, legacy] loop
  if public.friends_action('accept_invite', p_code=>candidate)->>'invitationState' <> 'already_accepted' then raise exception 'Consumed invitation was not recognized'; end if;
  end loop;
  if (select count(*) from public.friend_invites where user_id=sender) <> 2 then raise exception 'Acceptance consumed other links'; end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform public.friends_action('save_profile', 'Other', false, false);
  perform public.friends_action('revoke_invite', p_code=>newer);
  begin
    perform public.friends_action('revoke_previous_invites', p_code=>newer);
    raise exception 'Revocation crossed owners';
  exception when no_data_found then null; end;
  if not exists(select 1 from public.friend_invites where preview_id=newer) then raise exception 'Someone else revoked link'; end if;
  perform set_config('request.jwt.claim.sub', sender::text, true);
  perform public.friends_action('revoke_previous_invites', p_code=>newer);
  if exists(select 1 from public.friend_invites where preview_id=earlier) then raise exception 'Previous links not revoked'; end if;
  perform public.friends_action('revoke_invite', p_code=>newer);
  if exists(select 1 from public.friend_invites where preview_id=newer) then raise exception 'Specific link not revoked'; end if;
  key := public.friends_action('create_invite')->>'previewId';
  update public.friend_invites set expires_at=now()-interval '1 second' where preview_id=key;
  perform set_config('request.jwt.claim.sub', recipient::text, true);
  foreach candidate in array array[key, earlier, newer] loop
    begin
      perform public.friends_action('accept_invite', p_code=>candidate);
      raise exception 'Expired or cancelled invitation remained usable';
    exception when no_data_found then null; end;
  end loop;
  if has_table_privilege('anon','public.friend_invites','select') or has_table_privilege('authenticated','public.friend_invites','select') then raise exception 'Invitation keys exposed through table access'; end if;
  if has_function_privilege('anon','public.friends_action(text,text,boolean,boolean,text,uuid)','execute') then raise exception 'Anonymous acceptance RPC exposed'; end if;
end $$;
rollback;
select 'Standalone invitations: consent, auth, single use, expiry, revocation and legacy compatibility passed' as result;
