-- Short IDs now authorize an invitation as well as its preview, so canonical
-- social-card URLs still work when a messenger discards the old fragment.
-- Existing IDs, legacy tokens, expiry, ownership, and single-use semantics remain.
create or replace function public.friends_action(
  p_action text, p_nickname text default null, p_share_stats boolean default null,
  p_share_arrival boolean default null, p_code text default null, p_friend_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); owner uuid; code text; expiry timestamptz; preview text; target_name text; inserted_count integer; invite_id bigint; previous_count integer;
begin
  if actor is null or not exists (select 1 from auth.users where id = actor and not is_anonymous) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if p_action = 'save_profile' then
    if p_nickname is null or char_length(btrim(p_nickname, U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) not between 1 and 24 or p_nickname ~ U&'[[:cntrl:]\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]'
       or p_share_stats is null or p_share_arrival is null then
      raise exception 'Invalid friend profile' using errcode = '22023';
    end if;
    insert into public.friend_profiles(user_id, nickname, share_stats, share_arrival)
      values(actor, btrim(p_nickname, U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), p_share_stats, p_share_arrival)
      on conflict(user_id) do update set nickname = excluded.nickname, share_stats = excluded.share_stats, share_arrival = excluded.share_arrival;
  elsif p_action = 'acknowledge_friend' then
    update public.friendship_updates u set seen_at = now() from public.friend_profiles f
      where u.recipient_id = actor and u.friend_user_id = f.user_id and f.id = p_friend_id and u.seen_at is null;
  elsif p_action = 'disable' then
    delete from public.friend_profiles where user_id = actor;
  elsif p_action = 'remove_friend' then
    select user_id into owner from public.friend_profiles where id = p_friend_id;
    delete from public.friend_connections where user_low = least(actor, owner) and user_high = greatest(actor, owner);
  elsif p_action in ('revoke_invite', 'revoke_previous_invites') then
    if p_code is not null and p_code !~ '^([A-Za-z0-9_-]{16}|[a-f0-9]{32})$' then
      raise exception 'Invalid invitation' using errcode = '22023';
    end if;
    -- Serialize revocation with creation and acceptance for this owner.
    perform 1 from public.friend_profiles where user_id = actor for update;
    if p_action = 'revoke_previous_invites' then
      select id into invite_id from public.friend_invites where user_id = actor
        and (preview_id = p_code or code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')) and expires_at > now();
      if not found then raise exception 'Invitation unavailable' using errcode = 'P0002'; end if;
      delete from public.friend_invites where user_id = actor and id < invite_id;
      return jsonb_build_object('snapshot', public.friends_snapshot(), 'previousInviteCount', 0);
    elsif p_code is not null then
      delete from public.friend_invites where user_id = actor
        and (preview_id = p_code or code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex'));
    else
      -- Existing clients and sharing preferences can still revoke every link.
      delete from public.friend_invites where user_id = actor;
    end if;
  elsif p_action = 'create_invite' then
    perform 1 from public.friend_profiles where user_id = actor for update;
    if not found then raise exception 'Create your friend profile first' using errcode = '22023'; end if;
    delete from public.friend_invites where user_id = actor and expires_at <= now();
    code := replace(gen_random_uuid()::text, '-', '');
    expiry := now() + interval '7 days';
    insert into public.friend_invites(user_id, code_hash, expires_at)
      values(actor, encode(sha256(convert_to(code, 'UTF8')), 'hex'), expiry)
      returning preview_id, id into preview, invite_id;
    select count(*)::integer into previous_count from public.friend_invites
      where user_id = actor and id < invite_id and expires_at > now();
    return jsonb_build_object('inviteCode', code, 'previewId', preview, 'expiresAt', expiry, 'previousInviteCount', previous_count);
  elsif p_action in ('preview_invite', 'accept_invite') then
    if p_code is null or p_code !~ '^([A-Za-z0-9_-]{16}|[a-f0-9]{32})$' then
      raise exception 'Invitation unavailable' using errcode = 'P0002';
    end if;
    -- A preview discloses only the nickname and consumes nothing.
    select i.user_id, f.nickname, i.id into owner, target_name, invite_id
      from public.friend_invites i join public.friend_profiles f on f.user_id = i.user_id
      where (i.preview_id = p_code or i.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex'))
        and i.expires_at > now();
    if owner is null then raise exception 'Invitation unavailable' using errcode = 'P0002'; end if;
    if owner = actor then raise exception 'Cannot accept your own invitation' using errcode = 'P0004'; end if;
    if p_action = 'preview_invite' then return jsonb_build_object('previewNickname', target_name); end if;
    -- Lock both profiles in a consistent order to bound concurrent friend counts.
    perform 1 from public.friend_profiles where user_id in (actor, owner) order by user_id for update;
    -- Recheck after locking profiles: revocation, expiry, or another acceptance wins safely.
    perform 1 from public.friend_invites where user_id = owner
      and id = invite_id and expires_at > now() for update;
    if not found then raise exception 'Invitation unavailable' using errcode = 'P0002'; end if;
    if not exists(select 1 from public.friend_profiles where user_id = actor) then
      raise exception 'Create your friend profile first' using errcode = '22023';
    end if;
    if (select count(*) from public.friend_connections where actor in (user_low, user_high)) >= 50
       or (select count(*) from public.friend_connections where owner in (user_low, user_high)) >= 50 then
      raise exception 'Your circle is full' using errcode = 'P0003';
    end if;
    insert into public.friend_connections(user_low, user_high) values(least(actor,owner), greatest(actor,owner)) on conflict do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count > 0 then
      insert into public.friendship_updates(recipient_id, friend_user_id, user_low, user_high)
        values(owner, actor, least(actor, owner), greatest(actor, owner));
    end if;
    delete from public.friend_invites where user_id = owner and id = invite_id;
    return jsonb_build_object('snapshot', public.friends_snapshot(), 'acceptedFriend', private.friend_card(owner));
  else
    raise exception 'Unknown Friends action' using errcode = '22023';
  end if;
  return jsonb_build_object('snapshot', public.friends_snapshot());
end;
$$;

notify pgrst, 'reload schema';
