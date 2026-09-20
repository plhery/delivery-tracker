\set ON_ERROR_STOP on
begin;
truncate public.tracking_health_samples, public.tracking_health_incidents;
create function pg_temp.health_sample(subject text, healthy boolean, kind text default 'provider', package_id uuid default '10000000-0000-4000-8000-000000000001', attempt_id uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.record_tracking_health(attempt_id,package_id,jsonb_build_array(jsonb_build_object(
    'kind',kind,'subject',subject,'healthy',healthy,'details',jsonb_build_object('error_type','TransportError'))));
$$;
create function pg_temp.answered_sample(subject text)
returns jsonb language sql as $$
  select public.record_tracking_health(gen_random_uuid(),null,jsonb_build_array(jsonb_build_object(
    'kind','provider','subject',subject,'healthy',true,'details',jsonb_build_object('error_type','NotFoundError','category','not_found'))));
$$;
do $$
declare result jsonb; sample_id uuid := gen_random_uuid(); notice_id uuid;
begin
  for i in 1..9 loop
    result := pg_temp.health_sample('test-provider',false);
    assert result='[]', 'A small sample must not alert';
  end loop;
  result := pg_temp.health_sample('test-provider',false,'provider',null,sample_id);
  assert jsonb_array_length(result)=1 and result->0->>'state'='open', 'Ten failing lookups must alert';
  assert (result->0->>'failures')::int=10;
  notice_id := (result->0->>'id')::uuid;
  assert pg_temp.health_sample('test-provider',false,'provider',null,sample_id)='[]', 'A duplicate must neither count nor send twice';
  assert (select count(*) from public.tracking_health_samples where subject='test-provider')=10;
  update public.tracking_health_incidents set lease_until=now()-interval '1 second' where subject='test-provider';
  result := pg_temp.health_sample('test-provider',false,'provider',null,sample_id);
  assert (result->0->>'id')::uuid=notice_id, 'Failed delivery must retain the same pending notification';
  perform public.ack_tracking_health(array[notice_id]);
  assert pg_temp.health_sample('test-provider',false)='[]', 'An active incident must be suppressed for six hours';
  assert pg_temp.health_sample('test-provider',true)='[]';
  assert pg_temp.health_sample('test-provider',true)='[]';
  result := pg_temp.health_sample('test-provider',true);
  assert result->0->>'state'='recovered', 'Three consecutive successful probes must recover';
  perform public.ack_tracking_health(array[(result->0->>'id')::uuid]);
  assert pg_temp.health_sample('test-provider',false)='[]', 'Historical errors must not cause an immediate re-open';
  update public.tracking_health_incidents set last_notified_at=now()-interval '7 hours' where subject='test-provider';
  result := pg_temp.health_sample('test-provider',false);
  assert result->0->>'state'='open';

  assert pg_temp.health_sample('test-carrier',false,'refresh')='[]';
  assert pg_temp.health_sample('test-carrier',false,'refresh')='[]';
  assert pg_temp.health_sample('test-carrier',false,'refresh','20000000-0000-4000-8000-000000000001')='[]', 'Failures on different parcels must not form a streak';
  result := pg_temp.health_sample('test-carrier',false,'refresh');
  assert result->0->>'consecutive_failures'='true', 'Same parcel failing three times must alert';
  perform public.ack_tracking_health(array[(result->0->>'id')::uuid]);
  for i in 1..3 loop result := pg_temp.health_sample('test-carrier',true,'refresh','20000000-0000-4000-8000-000000000001'); end loop;
  assert result='[]', 'Other healthy parcels must not clear a still-failing parcel';

  for i in 1..10 loop result := pg_temp.health_sample('half-failing',i%2=0); end loop;
  assert result='[]', 'Exactly 50 percent must not alert';
  result := pg_temp.health_sample('half-failing',false);
  assert result->0->>'state'='open';

  for i in 1..5 loop result := pg_temp.health_sample('rate-carrier',false,'refresh',gen_random_uuid()); end loop;
  assert result->0->>'state'='open' and result->0->>'consecutive_failures'='false', 'Five failures across parcels must trigger the rate condition';

  -- A healthy not-found answer recovers an incident but never dilutes the outage rate.
  for i in 1..10 loop result := pg_temp.answered_sample('probe-carrier'); end loop;
  for i in 1..9 loop result := pg_temp.health_sample('probe-carrier',false); end loop;
  assert result='[]', 'Answered probes must not count toward the ten-lookup minimum';
  result := pg_temp.health_sample('probe-carrier',false);
  assert result->0->>'state'='open' and (result->0->>'attempts')::int=10, 'Ten real failures must alert despite healthy not-found answers';
  perform public.ack_tracking_health(array[(result->0->>'id')::uuid]);
  assert pg_temp.answered_sample('probe-carrier')='[]';
  assert pg_temp.answered_sample('probe-carrier')='[]';
  result := pg_temp.answered_sample('probe-carrier');
  assert result->0->>'state'='recovered', 'Three answered probes must recover an incident';
  -- A tier that is no longer probed cannot recover; its incident closes when the evidence expires.
  for i in 1..10 loop result := pg_temp.health_sample('retired-tier',false,'direct'); end loop;
  assert result->0->>'state'='open';
  perform public.ack_tracking_health(array[(result->0->>'id')::uuid]);
  assert (select active from public.tracking_health_incidents where kind='direct' and subject='retired-tier');
  assert pg_temp.health_sample('other-tier',true)='[]';
  assert (select active from public.tracking_health_incidents where kind='direct' and subject='retired-tier'),
    'An incident with evidence inside the window must stay open';
  update public.tracking_health_samples set observed_at=now()-interval '25 hours' where subject='retired-tier';
  assert pg_temp.health_sample('other-tier',true)='[]', 'An expired incident must close without a notification';
  assert not (select active from public.tracking_health_incidents where kind='direct' and subject='retired-tier'),
    'An incident whose evidence expired must close';
  -- A notice still waiting for delivery keeps its incident until it has been acknowledged.
  for i in 1..10 loop result := pg_temp.health_sample('unsent-tier',false,'direct'); end loop;
  perform public.ack_tracking_health(array[(result->0->>'id')::uuid]);
  for i in 1..3 loop result := pg_temp.health_sample('unsent-tier',true,'direct'); end loop;
  assert result->0->>'state'='recovered';
  update public.tracking_health_samples set observed_at=now()-interval '25 hours' where subject='unsent-tier';
  assert pg_temp.health_sample('other-tier',true)='[]';
  assert (select active and pending is not null from public.tracking_health_incidents where kind='direct' and subject='unsent-tier'),
    'A pending recovery notice must survive the sweep';
  -- A tier still failing when traffic resumes opens a new incident.
  update public.tracking_health_incidents set last_notified_at=now()-interval '7 hours' where subject='retired-tier';
  for i in 1..10 loop result := pg_temp.health_sample('retired-tier',false,'direct'); end loop;
  assert result->0->>'state'='open', 'A closed incident must reopen on fresh failures';
  assert not has_function_privilege('authenticated','public.record_tracking_health(uuid,uuid,jsonb)','execute');
  assert not has_table_privilege('anon','public.tracking_health_samples','select');
end;
$$;
rollback;
