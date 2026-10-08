\set ON_ERROR_STOP on
begin;

-- Only the server reads and writes what readers said.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.parcel_feedback', 'SELECT')
        or has_table_privilege(role_name, 'public.parcel_feedback', 'INSERT')
        or has_function_privilege(role_name, 'public.record_parcel_feedback(jsonb)', 'EXECUTE')
        or has_function_privilege(role_name, 'public.forget_old_parcel_feedback()', 'EXECUTE') then
      raise exception 'Parcel feedback must be reserved to the server (%)', role_name;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.record_parcel_feedback(jsonb)', 'EXECUTE')
      or not has_function_privilege('service_role', 'public.forget_old_parcel_feedback()', 'EXECUTE')
      or not has_table_privilege('service_role', 'public.parcel_feedback', 'SELECT') then
    raise exception 'The server must be able to keep and read parcel feedback';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.parcel_feedback'::regclass) then
    raise exception 'Parcel feedback must be behind row level security';
  end if;
  -- An answer names its parcel by number alone: nothing ties it to an account, a link or a device.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parcel_feedback'
      and column_name in ('user_id', 'package_id', 'link_id', 'installation_id', 'ip', 'owner_key_hash')
  ) or exists (
    select 1 from pg_constraint where conrelid = 'public.parcel_feedback'::regclass and contype = 'f'
  ) then
    raise exception 'Parcel feedback must not point at who gave it';
  end if;
end;
$$;

create function pg_temp.answer(p_id uuid, p_number text, p_answer text, p_more jsonb default '{}')
returns text
language sql
as $$
  select public.record_parcel_feedback(jsonb_build_object(
    'id', p_id, 'tracking_number', p_number, 'carrier', 'dpd', 'answer', p_answer,
    'asked', 'page', 'via', 'link', 'app', 'web', 'locale', 'en',
    'server_version', 'test', 'shown', '{"event_count": 2}'::jsonb
  ) || p_more);
$$;

do $$
declare
  first_id constant uuid := 'f4000000-0000-4000-8000-000000000001';
  kept public.parcel_feedback;
  outcome text;
begin
  -- A reason, then a note under the same id: one row, its words replaced.
  if pg_temp.answer(first_id, 'FEEDBACKTEST0001', 'wrong', '{"reasons": ["status"]}') <> 'stored' then
    raise exception 'A first answer must be stored';
  end if;
  if pg_temp.answer(first_id, 'FEEDBACKTEST0001', 'wrong', '{"reasons": ["status", "steps"], "note": "Arrived on Monday"}') <> 'replaced' then
    raise exception 'The same id within the hour must replace the words';
  end if;
  select * into kept from public.parcel_feedback where id = first_id;
  if kept.reasons <> array['status', 'steps'] or kept.note <> 'Arrived on Monday' or kept.carrier <> 'dpd'
      or kept.shown <> '{"event_count": 2}'::jsonb or kept.reviewed_at is not null then
    raise exception 'A replaced answer must keep its parcel and take the new words: %', to_jsonb(kept);
  end if;
  if (select count(*) from public.parcel_feedback where tracking_number = 'FEEDBACKTEST0001') <> 1 then
    raise exception 'Replacing an answer must not add a row';
  end if;

  -- An id cannot be moved to another parcel or another answer, nor reused after an hour.
  if pg_temp.answer(first_id, 'FEEDBACKTEST0002', 'wrong', '{"reasons": ["status"]}') <> 'closed'
      or pg_temp.answer(first_id, 'FEEDBACKTEST0001', 'right') <> 'closed' then
    raise exception 'An id must stay with its parcel and its answer';
  end if;
  update public.parcel_feedback set created_at = now() - interval '61 minutes' where id = first_id;
  if pg_temp.answer(first_id, 'FEEDBACKTEST0001', 'wrong', '{"note": "Later"}') <> 'closed' then
    raise exception 'An answer must close an hour after it was given';
  end if;
  if (select note from public.parcel_feedback where id = first_id) <> 'Arrived on Monday' then
    raise exception 'A closed answer must keep its words';
  end if;

  -- Each answer carries only its own words.
  if pg_temp.answer('f4000000-0000-4000-8000-000000000002', 'FEEDBACKTEST0003', 'found_elsewhere', '{"carrier_name": "Example Post"}') <> 'stored'
      or pg_temp.answer('f4000000-0000-4000-8000-000000000003', 'FEEDBACKTEST0003', 'right') <> 'stored' then
    raise exception 'A named carrier and a plain yes must be stored';
  end if;
  begin
    perform pg_temp.answer('f4000000-0000-4000-8000-000000000004', 'FEEDBACKTEST0003', 'wrong');
    raise exception 'A wrong answer without a word must be refused';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.answer('f4000000-0000-4000-8000-000000000004', 'FEEDBACKTEST0003', 'right', '{"note": "Words"}');
    raise exception 'A right answer with words must be refused';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.answer('f4000000-0000-4000-8000-000000000004', 'FEEDBACKTEST0003', 'wrong', '{"reasons": ["weather"]}');
    raise exception 'An unknown reason must be refused';
  exception when check_violation then null;
  end;
  begin
    perform public.record_parcel_feedback('{"answer": "right"}');
    raise exception 'An answer without an id must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- A parcel takes twenty answers a day, whoever holds its link.
  for step in 1..20 loop
    outcome := pg_temp.answer(('f4000000-0000-4000-8000-0000000001' || lpad(step::text, 2, '0'))::uuid, 'FEEDBACKTEST0004', 'right');
    if outcome <> 'stored' then raise exception 'Answer % must be stored, got %', step, outcome; end if;
  end loop;
  if pg_temp.answer('f4000000-0000-4000-8000-000000000199', 'FEEDBACKTEST0004', 'right') <> 'full' then
    raise exception 'The twenty-first answer of a day must be refused';
  end if;
  -- One already given can still take its note.
  if pg_temp.answer('f4000000-0000-4000-8000-000000000120', 'FEEDBACKTEST0004', 'right') <> 'replaced' then
    raise exception 'A full day must not close the answers it holds';
  end if;
  update public.parcel_feedback set created_at = now() - interval '25 hours' where tracking_number = 'FEEDBACKTEST0004';
  if pg_temp.answer('f4000000-0000-4000-8000-000000000199', 'FEEDBACKTEST0004', 'right') <> 'stored' then
    raise exception 'A new day must take answers again';
  end if;

  -- Ninety days after it was given, an answer is deleted, reviewed or not.
  update public.parcel_feedback set created_at = now() - interval '91 days', reviewed_at = now()
  where id = first_id;
  update public.parcel_feedback set created_at = now() - interval '89 days'
  where id = 'f4000000-0000-4000-8000-000000000002';
  if public.forget_old_parcel_feedback() <> 1 then
    raise exception 'Only the answers past ninety days must be deleted';
  end if;
  if exists (select 1 from public.parcel_feedback where id = first_id)
      or not exists (select 1 from public.parcel_feedback where id = 'f4000000-0000-4000-8000-000000000002') then
    raise exception 'The wrong answers were deleted';
  end if;
end;
$$;

rollback;
