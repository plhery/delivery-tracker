-- A link's events say which rows Peek wrote itself, so the server can leave
-- "Tracking added" out once the carrier's scans reach back to it, as it does
-- for an account's parcels (see eventPlaces.ts). The server reads the source
-- and never passes it on.
--
-- Apply this before deploying the server that reads it. The server before it
-- ignores the extra key, and the server after it shows every row of a link
-- whose view lacks it.

begin;

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
        'provider_event_id', event.provider_event_id,
        'point', event.raw_data->'point'
      ) order by event.occurred_at desc)
      from public.tracking_events as event
      where event.package_id = package.id
    ), '[]'::jsonb))
  );
end;
$$;

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008193000_link_timeline_sources') on conflict do nothing;

commit;
