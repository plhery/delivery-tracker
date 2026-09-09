\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('fa000000-0000-4000-8000-000000000001','stamps-a@example.test'),
 ('fa000000-0000-4000-8000-000000000002','stamps-b@example.test');
insert into public.friend_profiles(user_id,nickname,share_stats,share_arrival) values
 ('fa000000-0000-4000-8000-000000000001','Stamp owner',true,false),
 ('fa000000-0000-4000-8000-000000000002','Stamp viewer',false,false);
insert into public.friend_connections(user_low,user_high) values
 ('fa000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002');

create function pg_temp.stamp_parcel(p_owner uuid, p_scans jsonb, p_carrier text default 'ups')
returns uuid language plpgsql as $$
declare parcel uuid := gen_random_uuid();
begin
 insert into public.packages(id,user_id,tracking_number,label,carrier,archived_at)
 values(parcel,p_owner,upper(replace(parcel::text,'-','')),'PRIVATE_CONTENT',p_carrier,now());
 insert into public.tracking_events(package_id,stage,occurred_at,location,description)
 select parcel,(scan->>0),(scan->>1)::timestamptz,scan->>2,'PRIVATE_SCAN'
 from jsonb_array_elements(p_scans) scan;
 return parcel;
end $$;

do $$
declare owner uuid := 'fa000000-0000-4000-8000-000000000001'; countries text[] := array['CH','DE','FR','IT','GB'];
 stamps jsonb; first_parcel uuid; i integer; view jsonb;
begin
 if private.passport_country('Wilmington, DE') is not null or private.passport_country('Geneva, GE') is not null
    or private.passport_country('Berlin, Germany') <> 'DE' or private.passport_country('Paris (Français)') is not null
    or private.passport_country('Zurich, Schweiz') <> 'CH' or private.passport_country('Genève, Suisse') <> 'CH'
    or private.passport_country('Berna, Svizzera') <> 'CH' or private.passport_country('DE') <> 'DE' then
   raise exception 'Country evidence differs from Passport';
 end if;
 for i in 1..25 loop
   first_parcel := pg_temp.stamp_parcel(owner,jsonb_build_array(
     jsonb_build_array('accepted',case when i=1 then '2024-10-01T00:00:00Z' else '2024-11-30T12:00:00Z' end,countries[(i-1)%5+1]),
     jsonb_build_array('ready_for_pickup','2024-12-01T10:00:00Z','CH'),
     jsonb_build_array('delivered','2024-12-01T12:00:00Z','CH'),
     jsonb_build_array('delivered','2024-12-02T12:00:00Z','CH')
   ),(case i%3 when 0 then 'dhl' when 1 then 'ups' else 'dpd' end)::text);
 end loop;
 stamps := private.friend_card(owner)#>'{stats,stamps}';
 if stamps <> '["first","ten","connected","express","acrossBorders","aroundWorld","theRegular","rightNextDoor","worthTheWait","busyDoorstep","pickedUp","homeForHolidays"]' then
   raise exception 'Expected all twelve stamps, got %',stamps;
 end if;
 if private.friend_card(owner)#>>'{stats,deliveredCount}' <> '25' then raise exception 'Duplicate delivery scans counted twice'; end if;
 perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
 view := public.friends_snapshot();
 if view#>'{friends,0,stats,stamps}' <> stamps or view::text ~ 'PRIVATE|tracking|location|occurred_at' then raise exception 'Shared stamp projection is incorrect'; end if;
 delete from public.packages where id=first_parcel;
 if private.friend_card(owner)#>'{stats,stamps}' ? 'theRegular' then raise exception 'Regular earned before 25 deliveries'; end if;
 update public.friend_profiles set share_stats=false where user_id=owner;
 if public.friends_snapshot()#>'{friends,0,stats}' <> 'null' then raise exception 'Opt-out exposed stamps'; end if;
end $$;

-- Use one owner repeatedly to isolate evidence and timing boundaries.
delete from public.packages where user_id='fa000000-0000-4000-8000-000000000001';
update public.friend_profiles set share_stats=true where user_id='fa000000-0000-4000-8000-000000000001';
do $$
declare owner uuid := 'fa000000-0000-4000-8000-000000000001'; parcel uuid; stamps jsonb; before_zone jsonb;
begin
 parcel := pg_temp.stamp_parcel(owner,'[["accepted","2024-01-01T00:00:00Z","Wilmington, DE"],["delivered","2024-01-31T00:00:00Z","Geneva, GE"]]');
 stamps := private.friend_card(owner)#>'{stats,stamps}';
 if stamps <> '["first"]' then raise exception 'Ambiguous countries or exactly 30 days earned a stamp: %',stamps; end if;
 update public.tracking_events set occurred_at=occurred_at+interval '1 millisecond' where package_id=parcel and stage='delivered';
 if not (private.friend_card(owner)#>'{stats,stamps}' ? 'worthTheWait') then raise exception 'More than 30 days did not earn waiting stamp'; end if;
 delete from public.packages where id=parcel;
 parcel := pg_temp.stamp_parcel(owner,'[["registered","2024-01-01T00:00:00Z","DE"],["accepted","2024-01-02T00:00:00Z",null],["delivered","2024-01-03T00:00:00Z","CH"]]');
 if private.friend_card(owner)#>'{stats,stamps}' ? 'acrossBorders' then raise exception 'Registration inferred a journey'; end if;
 delete from public.packages where id=parcel;
 parcel := pg_temp.stamp_parcel(owner,'[["accepted","2024-01-01T00:00:00Z","DE"],["ready_for_pickup","2024-01-01T00:00:00Z","CH"],["delivered","2024-01-01T00:00:00Z","CH"]]');
 if private.friend_card(owner)#>'{stats,stamps}' <> '["first"]' then raise exception 'Tied scans inferred travel or pickup'; end if;
 delete from public.packages where id=parcel;
 parcel := pg_temp.stamp_parcel(owner,'[["accepted","2024-11-01T00:00:00Z","DE"],["ready_for_pickup","2024-12-01T00:00:00Z","CH"],["delivered","2024-12-02T00:00:00Z","CH"],["returned","2024-12-03T00:00:00Z",null]]');
 if private.friend_card(owner)#>'{stats,stamps}' <> '[]' then raise exception 'Returned parcel earned a delivery stamp'; end if;
 delete from public.packages where id=parcel;
 perform pg_temp.stamp_parcel(owner,'[["delivered","2024-11-30T23:30:00Z",null],["delivered","2024-12-01T12:00:00Z",null]]');
 perform pg_temp.stamp_parcel(owner,'[["delivered","2024-12-01T10:00:00Z",null]]');
 perform pg_temp.stamp_parcel(owner,'[["delivered","2024-12-01T11:00:00Z",null]]');
 before_zone := private.friend_card(owner);
 if before_zone#>'{stats,stamps}' ? 'busyDoorstep' then raise exception 'UTC calendar grouped different days'; end if;
 perform set_config('TimeZone','Europe/Zurich',true);
 if private.friend_card(owner) <> before_zone then raise exception 'Viewer/session timezone changes shared awards'; end if;
end $$;

do $$ begin
 if has_function_privilege('authenticated','private.passport_country(text)','execute')
 or has_function_privilege('anon','private.friend_card(uuid)','execute') then raise exception 'Private helpers exposed'; end if;
end $$;
rollback;
select 'Shared Passport stamp assertions passed' as result;
