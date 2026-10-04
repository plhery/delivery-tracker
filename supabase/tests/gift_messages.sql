\set ON_ERROR_STOP on
begin;

set local role service_role;
do $$
declare
  answer jsonb;
  link_id text;
  parcel_id uuid;
  words constant jsonb := '{"name":"Trail shoes","note":"Happy birthday!","from":"Sam"}';
  key_hash constant text := repeat('a', 64);
  stage text;
begin
  answer := public.create_one_off_parcel('GIFTTEST0001', 'unknown', null, null, key_hash);
  link_id := answer#>>'{link,id}';
  parcel_id := (answer#>>'{package,id}')::uuid;
  answer := public.update_parcel_link(link_id, key_hash, p_gift => true, p_gift_words => words);
  if answer#>'{link,gift_words}' is distinct from words then
    raise exception 'The owner cannot read the saved gift message';
  end if;
  if public.update_parcel_link(link_id, repeat('b', 64), p_gift_words => '{}'::jsonb) is not null then
    raise exception 'A gift message changed without its owner key';
  end if;
  foreach stage in array array['pending', 'in_transit', 'out_for_delivery', 'ready_for_pickup', 'returned'] loop
    update public.packages set current_stage = stage where id = parcel_id;
    answer := public.parcel_link_view(link_id);
    if answer#>'{link,gift_words}' is distinct from 'null'::jsonb then
      raise exception 'A viewer can read the message before delivery';
    end if;
    if public.parcel_link_view(link_id, key_hash)#>'{link,gift_words}' is distinct from words then
      raise exception 'The owner lost the message';
    end if;
  end loop;
  update public.packages set current_stage = 'delivered' where id = parcel_id;
  if public.parcel_link_view(link_id)#>'{link,gift_words}' is distinct from words then
    raise exception 'A delivered gift withheld its message';
  end if;
  -- Changing only a switch preserves the message; an empty message explicitly clears it.
  perform public.update_parcel_link(link_id, key_hash, p_show_number => true);
  if public.parcel_link_view(link_id)#>'{link,gift_words}' is distinct from words then
    raise exception 'A switch erased the message';
  end if;
  perform public.update_parcel_link(link_id, key_hash, p_gift_words => '{"name":null,"note":null,"from":null}');
  if public.parcel_link_view(link_id)#>>'{link,gift_words,note}' is not null then
    raise exception 'The message could not be cleared';
  end if;
  begin
    perform public.update_parcel_link(link_id, key_hash, p_gift_words => jsonb_build_object('name', null, 'note', repeat('a', 281), 'from', null));
    raise exception 'An oversized message was accepted';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

insert into auth.users (id, email, is_anonymous) values
  ('d2000000-0000-4000-8000-000000000001', 'gift-sharer@example.test', false);
insert into public.packages (id, user_id, tracking_number, carrier) values
  ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'GIFTTEST0002', 'unknown');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true);
do $$
declare
  parcel_id constant uuid := 'd2000000-0000-4000-8000-000000000002';
  words constant jsonb := '{"name":null,"note":"Enjoy!","from":null}';
  answer jsonb;
begin
  answer := public.share_owned_package(parcel_id, p_gift => true, p_gift_words => words);
  if answer->'gift_words' is distinct from words or public.owned_package_share(parcel_id)->'gift_words' is distinct from words then
    raise exception 'The account cannot save and read its gift message';
  end if;
  perform public.share_owned_package(parcel_id, p_show_number => true);
  if public.owned_package_share(parcel_id)->'gift_words' is distinct from words then
    raise exception 'A switch erased the account gift message';
  end if;
end;
$$;
reset role;
rollback;
