\set ON_ERROR_STOP on
begin;

-- Applying the migration closed the wording its gaps cover, and nothing else.
do $$
begin
  assert (select resolution = 'ignored' and reviewed_at is not null and reviewed_version is null
      and review_note like 'DPD''s map leaves it unmapped on purpose%'
    from public.tracking_status_observations where observation_key = repeat('e', 64)), 'A deliberate code stayed open';
  assert (select resolution = 'ignored'
      and review_note = 'The label of IN_TRANSIT, which DPD''s map leaves unmapped on purpose.'
    from public.tracking_status_observations where observation_key = repeat('f', 64)), 'A deliberate label stayed open';
  assert (select reviewed_at is null and resolution is null and review_note is null
    from public.tracking_status_observations where observation_key = repeat('9', 64)), 'Another code was closed';
  assert (select reviewed_at is null
    from public.tracking_status_observations where observation_key = repeat('8', 64)), 'Another label was closed';
  assert (select resolution = 'mapped' and review_note is null
    from public.tracking_status_observations where observation_key = repeat('7', 64)), 'A review by hand was replaced';

  assert (select relrowsecurity from pg_class where oid = 'public.tracking_status_intentionally_unmapped'::regclass);
  assert (select relrowsecurity from pg_class where oid = 'public.tracking_review_runs'::regclass);
  assert not has_table_privilege('anon', 'public.tracking_status_intentionally_unmapped', 'select');
  assert not has_table_privilege('authenticated', 'public.tracking_status_intentionally_unmapped', 'insert');
  assert has_table_privilege('service_role', 'public.tracking_status_intentionally_unmapped', 'insert');
  assert not has_table_privilege('authenticated', 'public.tracking_review_runs', 'select');
  assert has_table_privilege('service_role', 'public.tracking_review_runs', 'select');
  assert not has_table_privilege('service_role', 'public.tracking_review_runs', 'update'), 'Only the claim functions write runs';
  assert not exists (
    select 1 from (values
      ('public.record_tracking_status_observations(jsonb,text[],text)'),
      ('public.close_intentionally_unmapped_observations(text,text[])'),
      ('public.close_intentionally_unmapped_after_change()'),
      ('public.claim_tracking_review_run(text,integer)'),
      ('public.finish_tracking_review_run(text,jsonb)'),
      ('public.fix_replayed_tracking_support_cases(text,jsonb)')
    ) as review_function(signature), (values ('anon'), ('authenticated')) as browser(role)
    where has_function_privilege(browser.role, review_function.signature, 'execute')
  ), 'Browser roles can run the review functions';
  assert has_function_privilege('service_role', 'public.record_tracking_status_observations(jsonb,text[],text)', 'execute');
  assert has_function_privilege('service_role', 'public.claim_tracking_review_run(text,integer)', 'execute');
  assert has_function_privilege('service_role', 'public.finish_tracking_review_run(text,jsonb)', 'execute');
  assert has_function_privilege('service_role', 'public.fix_replayed_tracking_support_cases(text,jsonb)', 'execute');
end;
$$;

set local role service_role;

do $$
declare
  mapped_key text := repeat('1', 64);
  conditional_key text := repeat('2', 64);
  gap_key text := repeat('3', 64);
  plain_key text := repeat('4', 64);
  coded_key text := repeat('5', 64);
  mapped jsonb := jsonb_build_object('observation_key', mapped_key, 'carrier', 'ctt', 'provider_code', '42',
    'description_normalized', 'synthetic sorted', 'stage_source', 'none', 'chosen_stage', 'in_transit');
  conditional jsonb := jsonb_build_object('observation_key', conditional_key, 'carrier', 'ctt', 'provider_code', '43',
    'description_normalized', 'synthetic held', 'stage_source', 'none', 'chosen_stage', 'in_transit');
begin
  perform public.record_tracking_status_observations(jsonb_build_array(mapped, conditional), '{}', 'scraper@1');
  assert (select last_seen_version = 'scraper@1' and reviewed_at is null
    from public.tracking_status_observations where observation_key = mapped_key);

  -- The running server names no version during a rollout, and closes nothing.
  perform public.record_tracking_status_observations('[]', array[mapped_key]);
  perform public.record_tracking_status_observations(jsonb_build_array(conditional));
  assert (select reviewed_at is null from public.tracking_status_observations where observation_key = mapped_key);
  assert (select last_seen_version is null and count = 2
    from public.tracking_status_observations where observation_key = conditional_key);

  -- A later version maps both; the same sync also saw the second unmapped, which stays open.
  perform public.record_tracking_status_observations(jsonb_build_array(conditional),
    array[mapped_key, conditional_key], 'scraper@2');
  assert (select resolution = 'mapped' and reviewed_at is not null and reviewed_version = 'scraper@2'
      and review_note = 'The carrier status map gave its stage.' and count = 1 and last_seen_version = 'scraper@1'
    from public.tracking_status_observations where observation_key = mapped_key), 'Mapped wording stayed open';
  assert (select reviewed_at is null and last_seen_version = 'scraper@2'
    from public.tracking_status_observations where observation_key = conditional_key), 'Wording seen unmapped was closed';

  -- Seen unmapped again by a server that names itself, the closing is undone: the map covers it only sometimes.
  perform public.record_tracking_status_observations(jsonb_build_array(mapped), '{}', 'scraper@3');
  assert (select reviewed_at is null and resolution is null and reviewed_version is null and review_note is null
      and count = 2 and last_seen_version = 'scraper@3'
    from public.tracking_status_observations where observation_key = mapped_key), 'A conditional mapping stayed closed';
  -- A review by hand is never undone.
  update public.tracking_status_observations set reviewed_at = now(), resolution = 'mapped'
  where observation_key = conditional_key;
  perform public.record_tracking_status_observations(jsonb_build_array(conditional), '{}', 'scraper@3');
  assert (select resolution = 'mapped' and reviewed_version is null
    from public.tracking_status_observations where observation_key = conditional_key), 'A review by hand was reopened';

  -- A gap recorded later closes the open wording it covers, then each new wording of it on sight.
  insert into public.tracking_status_intentionally_unmapped (carrier, provider_code, note)
  values ('ctt', '42', 'Synthetic gap.');
  assert (select resolution = 'ignored' and review_note = 'Synthetic gap.' and reviewed_version is null
    from public.tracking_status_observations where observation_key = mapped_key), 'A new gap left its wording open';
  perform public.record_tracking_status_observations(jsonb_build_array(jsonb_build_object(
    'observation_key', gap_key, 'carrier', 'ctt', 'provider_code', '42',
    'description_normalized', 'synthetic sorted again', 'stage_source', 'none', 'chosen_stage', 'in_transit')),
    '{}', 'scraper@3');
  assert (select resolution = 'ignored' and reviewed_version = 'scraper@3' and count = 1
    from public.tracking_status_observations where observation_key = gap_key), 'A new sighting of a gap stayed open';

  -- A gap without a code covers only wording that came without one, until it names one.
  insert into public.tracking_status_intentionally_unmapped (carrier, description_normalized, note)
  values ('ctt', 'synthetic plain wording', 'Synthetic label gap.');
  perform public.record_tracking_status_observations(jsonb_build_array(
    jsonb_build_object('observation_key', plain_key, 'carrier', 'ctt',
      'description_normalized', 'synthetic plain wording', 'stage_source', 'none', 'chosen_stage', 'in_transit'),
    jsonb_build_object('observation_key', coded_key, 'carrier', 'ctt', 'provider_code', '44',
      'description_normalized', 'synthetic plain wording', 'stage_source', 'none', 'chosen_stage', 'in_transit')
  ), '{}', 'scraper@3');
  assert (select resolution = 'ignored' from public.tracking_status_observations where observation_key = plain_key);
  assert (select reviewed_at is null from public.tracking_status_observations where observation_key = coded_key),
    'A label gap closed coded wording';
  update public.tracking_status_intentionally_unmapped set provider_code = '44'
  where carrier = 'ctt' and description_normalized = 'synthetic plain wording';
  assert (select resolution = 'ignored' and review_note = 'Synthetic label gap.'
    from public.tracking_status_observations where observation_key = coded_key), 'An edited gap left its wording open';

  begin
    insert into public.tracking_status_intentionally_unmapped (carrier, note) values ('ctt', 'Nothing named.');
    raise exception 'A gap without a code or wording was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_tracking_status_observations('{}');
    raise exception 'An observation object was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_tracking_status_observations('[]',
      array(select repeat('a', 64) from generate_series(1, 65)), 'scraper@3');
    raise exception 'Unbounded mapped keys were accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- One replay per version, across servers and restarts.
do $$
begin
  assert public.claim_tracking_review_run('scraper@1', 600) = 'claimed';
  assert public.claim_tracking_review_run('scraper@1', 600) = 'running', 'A held replay was claimed twice';
  assert public.claim_tracking_review_run('scraper@2', 600) = 'claimed', 'Versions shared a replay';
  begin
    perform public.claim_tracking_review_run('scraper@1', 0);
    raise exception 'A lease of no time was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;
-- The server holding the replay died with it.
update public.tracking_review_runs set lease_until = clock_timestamp() - interval '1 second' where version = 'scraper@1';
set local role service_role;

do $$
begin
  assert public.claim_tracking_review_run('scraper@1', 600) = 'claimed', 'An expired lease was not taken over';
  assert (select attempts = 2 from public.tracking_review_runs where version = 'scraper@1');
  assert public.finish_tracking_review_run('scraper@1', '{"cases_replayed":3,"cases_fixed":1}');
  assert not public.finish_tracking_review_run('scraper@1', '{"cases_replayed":0,"cases_fixed":0}'), 'A replay finished twice';
  assert (select result = '{"cases_replayed":3,"cases_fixed":1}'::jsonb and finished_at is not null
    from public.tracking_review_runs where version = 'scraper@1');
  assert public.claim_tracking_review_run('scraper@1', 600) = 'done', 'A finished replay was claimed again';
end;
$$;

do $$
declare
  royal uuid := public.record_tracking_support_observation('REPLAYTEST1',
    '{"configured_carrier":"royal-mail","reasons":["generic_postal"]}', '{}', '2026-10-04T18:00:00Z', 'test:replay-1');
  moved uuid := public.record_tracking_support_observation('REPLAYTEST2',
    '{"configured_carrier":"unknown","reasons":["unknown_shape"]}', '{}', '2026-10-04T18:00:00Z', 'test:replay-2');
  ignored uuid := public.record_tracking_support_observation('REPLAYTEST3',
    '{"configured_carrier":"dpd","reasons":["ambiguous_shape"]}', '{}', '2026-10-04T18:00:00Z', 'test:replay-3');
  unconfigured uuid := public.record_tracking_support_observation('REPLAYTEST4',
    '{"reasons":["unknown_shape"]}', '{}', '2026-10-04T18:00:00Z', 'test:replay-4');
  note text := 'Replay found no gap: detection names royal-mail with high confidence.';
begin
  update public.tracking_support_cases set notes = 'Earlier note.' where id = royal;
  update public.tracking_support_cases set fix_status = 'ignored' where id = ignored;
  assert public.fix_replayed_tracking_support_cases('scraper@2', jsonb_build_array(
    jsonb_build_object('id', royal, 'configured_carrier', 'royal-mail', 'note', note),
    -- Reconfigured since the replay read it.
    jsonb_build_object('id', moved, 'configured_carrier', 'dpd', 'note', note),
    jsonb_build_object('id', ignored, 'configured_carrier', 'dpd', 'note', note),
    jsonb_build_object('id', unconfigured, 'configured_carrier', null, 'note', note),
    jsonb_build_object('id', gen_random_uuid(), 'configured_carrier', null, 'note', note)
  )) = 2;
  assert (select fix_status = 'fixed' and fix_reference = 'scraper@2' and fixed_at is not null
      and notes = E'Earlier note.\n' || note
    from public.tracking_support_cases where id = royal), 'A replayed case was not fixed';
  assert (select fix_status = 'fixed' and notes = note from public.tracking_support_cases where id = unconfigured);
  assert (select fix_status = 'open' from public.tracking_support_cases where id = moved), 'A reconfigured case was fixed';
  assert (select fix_status = 'ignored' from public.tracking_support_cases where id = ignored), 'An ignored case was fixed';
  assert public.fix_replayed_tracking_support_cases('scraper@3', jsonb_build_array(
    jsonb_build_object('id', royal, 'configured_carrier', 'royal-mail', 'note', note))) = 0, 'A fixed case was fixed again';

  -- The parcel's next direct check verifies the replayed fix, as it does a fix by hand.
  perform public.record_tracking_support_observation('REPLAYTEST1', '{}',
    '{"outcome":"updated", "source_carrier":"royal-mail", "support_lookup_number":"REPLAYTEST1", "support_direct_progress":true}',
    clock_timestamp() + interval '1 minute', 'test:replay-direct');
  assert (select fix_status = 'verified' from public.tracking_support_cases where id = royal), 'Direct progress did not verify the replay';

  begin
    perform public.fix_replayed_tracking_support_cases('scraper@2', '{}');
    raise exception 'A case object was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;

delete from public.tracking_status_observations
where observation_key in (repeat('e', 64), repeat('f', 64), repeat('9', 64), repeat('8', 64), repeat('7', 64));
select 'review queue replay assertions passed' as result;
