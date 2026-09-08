\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values
  ('a8888888-8888-4888-8888-888888888888', 'multi-owner@example.test'),
  ('b8888888-8888-4888-8888-888888888888', 'multi-recipient@example.test'),
  ('c8888888-8888-4888-8888-888888888888', 'multi-other@example.test');

do $$
declare
  owner_id uuid := 'a8888888-8888-4888-8888-888888888888';
  recipient uuid := 'b8888888-8888-4888-8888-888888888888';
  other_id uuid := 'c8888888-8888-4888-8888-888888888888';
  codes text[] := '{}'; current_code text; newer_code text; other_code text; next_code text; result jsonb; i integer;
begin
  if not exists(select 1 from public.friend_invites where user_id='d8888888-8888-4888-8888-888888888888'
    and id is not null and preview_id='LegacyPreview123' and expires_at>now()
    and code_hash=encode(sha256(convert_to(repeat('cd',16),'UTF8')),'hex')) then
    raise exception 'The migration changed an existing invitation';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.friends_action('save_profile', 'Sender', false, false);
  for i in 0..6 loop
    result := public.friends_action('create_invite');
    if (result->>'previousInviteCount')::integer <> i then raise exception 'Wrong previous invitation count: %', result; end if;
    codes := array_append(codes, result->>'inviteCode');
  end loop;
  current_code := codes[7];
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 7 then raise exception 'Creation replaced an earlier invitation'; end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform public.friends_action('save_profile', 'Other sender', false, false);
  result := public.friends_action('create_invite');
  other_code := result->>'inviteCode';
  if (result->>'previousInviteCount')::integer <> 0 then raise exception 'Another owner’s invitation count leaked'; end if;
  begin
    perform public.friends_action('revoke_previous_invites', p_code=>current_code);
    raise exception 'Another owner revoked invitations';
  exception when no_data_found then null; end;
  perform public.friends_action('revoke_invite', p_code=>current_code);
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 7 then raise exception 'Scoped revocation crossed owners'; end if;
  for i in 1..7 loop
    if public.friends_action('preview_invite', p_code=>codes[i])->>'previewNickname' <> 'Sender' then raise exception 'Earlier link stopped working'; end if;
  end loop;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  newer_code := public.friends_action('create_invite')->>'inviteCode';
  result := public.friends_action('revoke_previous_invites', p_code=>current_code);
  if (result->>'previousInviteCount')::integer <> 0 then raise exception 'Previous invitations were not cleared'; end if;
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 2 then raise exception 'Current or newer invitation was revoked'; end if;
  if not exists(select 1 from public.friend_invites where user_id=other_id and code_hash=encode(sha256(convert_to(other_code,'UTF8')),'hex')) then raise exception 'Unrelated invitation was revoked'; end if;
  perform public.friends_action('revoke_previous_invites', p_code=>current_code);
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 2 then raise exception 'Repeated cancellation changed remaining links'; end if;

  perform set_config('request.jwt.claim.sub', recipient::text, true);
  perform public.friends_action('save_profile', 'Recipient', false, false);
  if public.friends_action('preview_invite', p_code=>repeat('cd',16))->>'previewNickname' <> 'Legacy sender' then raise exception 'Legacy invitation stopped working'; end if;
  for i in 1..6 loop
    begin
      perform public.friends_action('accept_invite', p_code=>codes[i]);
      raise exception 'Cancelled invitation remained usable';
    exception when no_data_found then null; end;
  end loop;
  perform public.friends_action('preview_invite', p_code=>current_code);
  perform public.friends_action('preview_invite', p_code=>newer_code);
  perform public.friends_action('accept_invite', p_code=>current_code);
  perform public.friends_action('preview_invite', p_code=>newer_code);
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 1 then raise exception 'Accepting consumed other invitations'; end if;
  if public.friends_action('accept_invite', p_code=>current_code)->>'invitationState' <> 'already_accepted' then raise exception 'Consumed invitation was not recognized'; end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  result := public.friends_action('create_invite'); next_code := result->>'inviteCode';
  if (result->>'previousInviteCount')::integer <> 1 then raise exception 'Consumed invitations were counted'; end if;
  perform public.friends_action('revoke_invite', p_code=>newer_code);
  if (select count(*) from public.friend_invites where user_id=owner_id) <> 1 then raise exception 'Cancelling one link cancelled another'; end if;
  update public.friend_invites set expires_at=now()-interval '1 second' where user_id=owner_id;
  result := public.friends_action('create_invite');
  if (result->>'previousInviteCount')::integer <> 0 then raise exception 'Expired invitations were counted'; end if;
  if exists(select 1 from public.friend_invites where user_id=owner_id and expires_at<=now()) then raise exception 'Expired invitations were not pruned'; end if;
  perform public.friends_action('create_invite');
  perform public.friends_action('revoke_invite');
  if exists(select 1 from public.friend_invites where user_id=owner_id) then raise exception 'Cancel-all left invitations behind'; end if;
  if jsonb_array_length(public.friends_snapshot()->'friends') <> 1 then raise exception 'Cancellation removed existing friends'; end if;
  if has_table_privilege('anon','public.friend_invites','select') or has_table_privilege('authenticated','public.friend_invites','select') then raise exception 'Invitation records exposed'; end if;
end $$;
rollback;
delete from auth.users where id='d8888888-8888-4888-8888-888888888888';
select 'Multiple invitation counts, revocation, single-use acceptance and privacy assertions passed' as result;
