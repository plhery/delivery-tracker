\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values ('b9999999-9999-4999-8999-999999999999', 'short-preview-recipient@example.test');

do $$
declare
 actor uuid := 'a9999999-9999-4999-8999-999999999999';
 recipient uuid := 'b9999999-9999-4999-8999-999999999999';
 old_preview text; preview text; code text; result jsonb;
begin
 select preview_id into old_preview from public.friend_invites where user_id=actor
   and code_hash=encode(sha256(convert_to(repeat('ab', 16), 'UTF8')), 'hex') and expires_at > now();
 if old_preview is null or old_preview !~ '^[A-Za-z0-9_-]{16}$' then raise exception 'Legacy invitation was not backfilled safely'; end if;
 perform set_config('request.jwt.claim.sub', recipient::text, true);
 if public.friends_action('preview_invite', p_code=>repeat('ab',16))->>'previewNickname' <> 'Legacy sender' then raise exception 'Legacy token stopped working'; end if;
 perform set_config('request.jwt.claim.sub', actor::text, true);
 result := public.friends_action('create_invite');
 code := result->>'inviteCode'; preview := result->>'previewId';
 if preview is null or preview !~ '^[A-Za-z0-9_-]{16}$' or preview=old_preview then raise exception 'Preview ID did not rotate'; end if;
 if code !~ '^[a-f0-9]{32}$' or preview=left(code,16) then raise exception 'Acceptance token and preview ID are not independent'; end if;
 if exists(select 1 from public.friend_invites where preview_id=old_preview) then raise exception 'Old preview still resolves'; end if;
 if not exists(select 1 from public.friend_invites where user_id=actor and preview_id=preview and expires_at > now()
   and code_hash=encode(sha256(convert_to(code,'UTF8')), 'hex')) then raise exception 'Short preview does not point to its invitation'; end if;
 perform set_config('request.jwt.claim.sub', recipient::text, true);
 begin
   perform public.friends_action('accept_invite', p_code=>preview);
   raise exception 'A preview ID was accepted as a bearer token';
 exception when no_data_found then null; end;
 perform public.friends_action('save_profile', 'Recipient', false, false);
 perform public.friends_action('accept_invite', p_code=>code);
 if exists(select 1 from public.friend_invites where preview_id=preview) then raise exception 'Consumed preview survived'; end if;
 perform set_config('request.jwt.claim.sub', actor::text, true);
 preview := public.friends_action('create_invite')->>'previewId';
 update public.friend_invites set expires_at=now()-interval '1 second' where preview_id=preview;
 if exists(select 1 from public.friend_invites where preview_id=preview and expires_at > now()) then raise exception 'Expired preview still resolves'; end if;
 preview := public.friends_action('create_invite')->>'previewId';
 perform public.friends_action('revoke_invite');
 if exists(select 1 from public.friend_invites where preview_id=preview) then raise exception 'Revoked preview survived'; end if;
 preview := public.friends_action('create_invite')->>'previewId';
 perform public.friends_action('disable');
 if exists(select 1 from public.friend_invites where preview_id=preview) then raise exception 'Disabled profile retained preview'; end if;
 if has_table_privilege('anon','public.friend_invites','select') or has_table_privilege('authenticated','public.friend_invites','select') then raise exception 'Preview IDs exposed the invitation table'; end if;
end $$;
rollback;
-- Remove the committed pre-migration fixture before the remaining suites run.
delete from auth.users where id='a9999999-9999-4999-8999-999999999999';
select 'Short invitation preview backfill, rotation, privacy and lifecycle assertions passed' as result;
