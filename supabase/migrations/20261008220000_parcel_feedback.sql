-- What a reader says of a parcel: that what Peek shows is right, what is off,
-- or who carries a parcel no carrier was found for.
--
-- An answer is stored with the parcel's number, its carrier and what the
-- service held about the parcel at that moment. It names no account, no link
-- and no device, so it cannot be traced to who gave it, and it outlives its
-- parcel. Every answer is deleted 90 days after it was given.
--
-- Apply this before deploying the server that uses it. The server before it
-- keeps working on this schema: it does not use the table.

begin;

create table public.parcel_feedback (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tracking_number text not null check (length(tracking_number) between 1 and 100),
  carrier text not null check (length(carrier) between 1 and 100),
  answer text not null check (answer in ('right', 'wrong', 'found_elsewhere')),
  reasons text[] not null default '{}' check (
    cardinality(reasons) <= 6
    and reasons <@ array['arrived', 'status', 'steps', 'time_place', 'carrier', 'other']
  ),
  note text check (length(note) between 1 and 1000),
  carrier_name text check (length(carrier_name) between 1 and 120),
  tracking_page text check (length(tracking_page) between 1 and 500),
  -- Where the question was asked: on the parcel's page, or on the way back from the carrier's site.
  asked text not null check (asked in ('page', 'back')),
  -- Through an account's parcel or through a link. Which account or link is not kept.
  via text not null check (via in ('account', 'link')),
  app text not null check (app in ('web', 'ios')),
  locale text not null check (length(locale) between 2 and 8),
  server_version text check (length(server_version) between 1 and 200),
  -- What the service held about the parcel when the answer was given.
  shown jsonb not null check (jsonb_typeof(shown) = 'object' and octet_length(shown::text) <= 16384),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  constraint parcel_feedback_words_check check (
    (answer = 'right' and reasons = '{}' and note is null and carrier_name is null and tracking_page is null)
    or (answer = 'wrong' and carrier_name is null and tracking_page is null
      and (cardinality(reasons) > 0 or note is not null))
    or (answer = 'found_elsewhere' and reasons = '{}' and note is null
      and (carrier_name is not null or tracking_page is not null))
  )
);
create index parcel_feedback_created_idx on public.parcel_feedback(created_at desc);
create index parcel_feedback_number_idx on public.parcel_feedback(tracking_number, created_at desc);
alter table public.parcel_feedback enable row level security;
revoke all on table public.parcel_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.parcel_feedback to service_role;

-- Stores an answer, or replaces the words of one given under the same id: a
-- note follows a reason. `stored` or `replaced`; `closed` when the id belongs
-- to another parcel or answer, or to one given more than an hour ago; `full`
-- when the parcel had twenty answers in a day, so a link anyone holds cannot
-- fill the table. Nothing is stored for the last two.
create function public.record_parcel_feedback(p_feedback jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  feedback_id constant uuid := (p_feedback->>'id')::uuid;
  number constant text := p_feedback->>'tracking_number';
  given_reasons constant text[] := array(
    select pg_catalog.jsonb_array_elements_text(coalesce(p_feedback->'reasons', '[]'))
  );
  existing public.parcel_feedback;
begin
  if feedback_id is null or number is null then
    raise exception 'Invalid parcel feedback' using errcode = '22023';
  end if;
  select * into existing from public.parcel_feedback where id = feedback_id for update;
  if found then
    if existing.tracking_number <> number or existing.answer <> p_feedback->>'answer'
        or existing.created_at < pg_catalog.now() - interval '1 hour' then
      return 'closed';
    end if;
    update public.parcel_feedback set
      reasons = given_reasons,
      note = p_feedback->>'note',
      carrier_name = p_feedback->>'carrier_name',
      tracking_page = p_feedback->>'tracking_page',
      updated_at = pg_catalog.now()
    where id = feedback_id;
    return 'replaced';
  end if;
  if (
    select pg_catalog.count(*) from public.parcel_feedback
    where tracking_number = number and created_at > pg_catalog.now() - interval '1 day'
  ) >= 20 then
    return 'full';
  end if;
  insert into public.parcel_feedback (
    id, tracking_number, carrier, answer, reasons, note, carrier_name, tracking_page,
    asked, via, app, locale, server_version, shown
  ) values (
    feedback_id, number, p_feedback->>'carrier', p_feedback->>'answer', given_reasons, p_feedback->>'note',
    p_feedback->>'carrier_name', p_feedback->>'tracking_page', p_feedback->>'asked', p_feedback->>'via',
    p_feedback->>'app', p_feedback->>'locale', p_feedback->>'server_version',
    coalesce(p_feedback->'shown', '{}')
  );
  return 'stored';
end;
$$;

-- Deletes the answers given more than 90 days ago, reviewed or not.
create function public.forget_old_parcel_feedback()
returns integer
language sql
security definer
set search_path = ''
as $$
  with forgotten as (
    delete from public.parcel_feedback where created_at < pg_catalog.now() - interval '90 days' returning 1
  )
  select pg_catalog.count(*)::integer from forgotten;
$$;

revoke all on function public.record_parcel_feedback(jsonb), public.forget_old_parcel_feedback()
  from public, anon, authenticated;
grant execute on function public.record_parcel_feedback(jsonb), public.forget_old_parcel_feedback()
  to service_role;

notify pgrst, 'reload schema';

insert into public.applied_migrations (name) values ('20261008220000_parcel_feedback') on conflict do nothing;

commit;
