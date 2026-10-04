begin;

-- Gift messages stay with the link and are withheld from viewers until delivery.
alter table public.parcel_links add column gift_words jsonb;
alter table public.parcel_links add constraint parcel_links_gift_words_check check (
  gift_words is null or (
    jsonb_typeof(gift_words) = 'object'
    and gift_words ?& array['name', 'note', 'from']
    and gift_words - array['name', 'note', 'from'] = '{}'::jsonb
    and jsonb_typeof(gift_words->'name') in ('string', 'null')
    and jsonb_typeof(gift_words->'note') in ('string', 'null')
    and jsonb_typeof(gift_words->'from') in ('string', 'null')
    and coalesce(length(gift_words->>'name'), 0) <= 80
    and coalesce(length(gift_words->>'note'), 0) <= 280
    and coalesce(length(gift_words->>'from'), 0) <= 60
  )
);

create or replace function public.parcel_link_view(
  p_link_id text,
  p_owner_key_hash text default null,
  p_touch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.parcel_links;
  package public.packages;
  forget_at timestamptz;
  is_owner boolean;
begin
  select * into link from public.parcel_links where id = p_link_id;
  if not found then return null; end if;
  forget_at := public.parcel_link_forget_at(link);
  if forget_at <= now() then return null; end if;
  is_owner := coalesce(link.owner_key_hash = p_owner_key_hash, false);
  if not link.shared and not is_owner then
    return jsonb_build_object('stopped', true);
  end if;
  if p_touch and link.last_opened_at < now() - interval '5 minutes' then
    update public.parcel_links set last_opened_at = now() where id = link.id
    returning * into link;
    forget_at := public.parcel_link_forget_at(link);
  end if;
  select * into package from public.packages where id = link.package_id;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', link.id,
      'owner', is_owner,
      'shared', link.created_by is not null,
      'show_number', link.show_number,
      'gift', link.gift,
      'gift_words', case when is_owner or (link.gift and package.current_stage = 'delivered') then link.gift_words end,
      'stopped', not link.shared,
      'created_at', link.created_at,
      'forget_at', forget_at
    ),
    'package', to_jsonb(package) || jsonb_build_object('tracking_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'package_id', event.package_id,
        'stage', event.stage,
        'description', event.description,
        'location', event.location,
        'occurred_at', case when event.provider_event_id like 'app:%'
          then greatest(event.occurred_at, link.created_at) else event.occurred_at end,
        'point', event.raw_data->'point'
      ) order by event.occurred_at desc)
      from public.tracking_events as event
      where event.package_id = package.id
    ), '[]'::jsonb))
  );
end;
$$;

create or replace function public.owned_package_share(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id and user_id = actor_id) then
    raise exception 'Package not found' using errcode = 'P0002';
  end if;
  return (
    select jsonb_build_object(
      'id', link.id, 'show_number', link.show_number, 'gift', link.gift, 'gift_words', link.gift_words, 'created_at', link.created_at
    )
    from public.parcel_links as link
    where link.package_id = p_package_id and link.created_by = actor_id and link.shared
  );
end;
$$;

drop function public.update_parcel_link(text, text, boolean, boolean, boolean);
create function public.update_parcel_link(
  p_link_id text,
  p_owner_key_hash text,
  p_show_number boolean default null,
  p_gift boolean default null,
  p_shared boolean default null,
  p_gift_words jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.parcel_links;
  was_shared boolean;
begin
  select * into link from public.parcel_links
  where id = p_link_id and owner_key_hash = p_owner_key_hash
  for update;
  if not found or public.parcel_link_forget_at(link) <= now() then return null; end if;
  was_shared := link.shared;

  update public.parcel_links
  set show_number = coalesce(p_show_number, show_number),
    gift = coalesce(p_gift, gift),
    gift_words = coalesce(p_gift_words, gift_words),
    shared = coalesce(p_shared, shared),
    stopped_at = case when coalesce(p_shared, shared) then null else coalesce(stopped_at, now()) end
  where id = link.id
  returning * into link;
  if was_shared and not link.shared then
    delete from public.parcel_link_alerts where link_id = link.id and not owner;
  end if;

  return public.parcel_link_view(link.id, p_owner_key_hash) || jsonb_build_object(
    'transition', case
      when was_shared and not link.shared then 'stopped'
      when link.shared and not was_shared then 'started'
    end
  );
end;
$$;

drop function public.share_owned_package(uuid, boolean, boolean);
create function public.share_owned_package(
  p_package_id uuid,
  p_show_number boolean default null,
  p_gift boolean default null,
  p_gift_words jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  link public.parcel_links;
  created boolean := false;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  -- The account lock of create_owned_package: one change to its links at a time.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if not exists (select 1 from public.packages where id = p_package_id and user_id = actor_id) then
    raise exception 'Package not found' using errcode = 'P0002';
  end if;

  update public.parcel_links
  set show_number = coalesce(p_show_number, show_number), gift = coalesce(p_gift, gift),
    gift_words = coalesce(p_gift_words, gift_words)
  where package_id = p_package_id and created_by = actor_id and shared
  returning * into link;
  if not found then
    insert into public.parcel_links (package_id, created_by, show_number, gift, gift_words)
    values (p_package_id, actor_id, coalesce(p_show_number, false), coalesce(p_gift, false), p_gift_words)
    returning * into link;
    created := true;
  end if;
  return jsonb_build_object(
    'id', link.id, 'show_number', link.show_number, 'gift', link.gift, 'gift_words', link.gift_words, 'created_at', link.created_at,
    'created', created
  );
end;
$$;

revoke all on function public.update_parcel_link(text, text, boolean, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.update_parcel_link(text, text, boolean, boolean, boolean, jsonb) to service_role;
revoke all on function public.share_owned_package(uuid, boolean, boolean, jsonb) from public, anon, service_role;
grant execute on function public.share_owned_package(uuid, boolean, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
