-- Records the migrations a database has, so a deployment can refuse a server
-- whose migrations production lacks. Every migration ends by recording its
-- own file name; scripts/test-migrations.sh checks that each one does.

create table public.applied_migrations (
  name text primary key check (name ~ '^[0-9]{14}_[a-z0-9_]+$'),
  applied_at timestamptz not null default now()
);
alter table public.applied_migrations enable row level security;
revoke all on table public.applied_migrations from public, anon, authenticated;

-- Which of the given migrations this database lacks. Their names are public,
-- so anyone may ask; the deployment does, with the publishable key.
create function public.missing_migrations(p_names text[])
returns text[]
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(array_agg(wanted.name order by wanted.name), '{}')
  from unnest(p_names[1:1000]) as wanted(name)
  where not exists (select 1 from public.applied_migrations as applied where applied.name = wanted.name);
$$;
revoke all on function public.missing_migrations(text[]) from public;
grant execute on function public.missing_migrations(text[]) to anon, authenticated, service_role;

-- The migrations before this one, all applied where this one is.
insert into public.applied_migrations (name) values
  ('20260701000000_init'),
  ('20260714000000_reliable_tracking'),
  ('20260715000000_shared_backend'),
  ('20260715100000_web_push'),
  ('20260715110000_pending_tracking_stage'),
  ('20260721000000_fix_quickpac_carriers'),
  ('20260805000000_archive_parcels'),
  ('20260805150000_validate_tracking_numbers'),
  ('20260805200000_restore_user_ownership'),
  ('20260805210000_own_push_subscriptions'),
  ('20260805220000_require_new_owners'),
  ('20260805230000_add_dpd_postcodes'),
  ('20260805235000_harden_user_mutations'),
  ('20260805235900_enforce_restore_quota'),
  ('20260806000000_add_dachser_tracking'),
  ('20260806010000_fix_dachser_key_regex'),
  ('20260806020000_notification_preferences'),
  ('20260806120000_delete_archived_packages'),
  ('20260806130000_fix_to_be_delivered_stage'),
  ('20260809160000_native_apns'),
  ('20260809170000_durable_sync_jobs'),
  ('20260810120000_delete_owned_packages'),
  ('20260815140000_reload_postgrest_schema'),
  ('20260825120000_notification_etas'),
  ('20260825160000_delivery_live_activities'),
  ('20260829190000_add_french_carriers'),
  ('20260830090000_add_deep_french_carriers'),
  ('20260830210000_add_regional_carriers'),
  ('20260831220000_tracking_observability'),
  ('20260901120000_add_amazon_logistics'),
  ('20260901130000_change_package_carrier'),
  ('20260901210000_add_india_post'),
  ('20260906120000_guard_tracking_sync_generation'),
  ('20260906140000_fix_planzer_event_stages'),
  ('20260907150000_notification_event_times'),
  ('20260907160000_localized_browser_push'),
  ('20260908100000_add_german_and_universal_carriers'),
  ('20260908160000_gls_swiss_delivery_postcodes'),
  ('20260909000000_private_friends'),
  ('20260909120000_friendship_receipts'),
  ('20260910120000_sync_job_lease_fencing'),
  ('20260911120000_distinguish_self_invitations'),
  ('20260911120000_live_activity_session_revocation'),
  ('20260911150000_short_invitation_previews'),
  ('20260911180000_keep_previous_invitations'),
  ('20260911200000_standalone_invitation_links'),
  ('20260911220000_invitation_outcomes'),
  ('20260911230000_friend_passport_stamps'),
  ('20260912090000_add_es_pt_pl_locales'),
  ('20260912090000_repair_carrier_history_stages'),
  ('20260912100000_link_package_tracking'),
  ('20260912110000_automatic_package_links'),
  ('20260912120000_carrier_handoff_links'),
  ('20260912140000_add_dhl_ecommerce'),
  ('20260912150000_tracking_provider_health'),
  ('20260912160000_preserve_carrier_change_history'),
  ('20260912170000_automatic_carrier_correction'),
  ('20260912180000_repair_audited_tracking_stages'),
  ('20260912190000_mondial_relay_barcodes'),
  ('20260912200000_deployment_recovery'),
  ('20260912210000_add_amazon_shipping'),
  ('20260912220000_add_100_carriers'),
  ('20260912230000_add_nacex_tracking_numbers'),
  ('20260913100000_tracking_status_observations'),
  ('20260913110000_exception_tracking_stage'),
  ('20260913120000_tracking_health_incidents'),
  ('20260915090000_tracking_health_answered_lookups'),
  ('20260920100000_tracking_health_expired_incidents'),
  ('20260921100000_add_upu_provider'),
  ('20260921160000_add_ems'),
  ('20260924090000_repair_proofread_tracking_stages'),
  ('20260925100000_relabel_planzer_delivered_events'),
  ('20260926170000_optional_dpd_postcode'),
  ('20261002090000_parcel_links'),
  ('20261002120000_parcel_sharing'),
  ('20261003100000_public_allowances'),
  ('20261003160000_delivery_emails'),
  ('20261003180000_unwatched_parcels'),
  ('20261004120000_superseded_removed_parcels'),
  ('20261004130000_add_omgo'),
  ('20261004140000_protected_gift_messages'),
  ('20261004150000_deduplicate_india_post_flights'),
  ('20261004170000_deduplicate_changed_scan_details'),
  ('20261004190000_tracking_support_cases'),
  ('20261004200000_tracking_stage_refinements'),
  ('20261004210000_account_tracking_budgets'),
  ('20261004230000_native_lookup_verification'),
  ('20261005000000_dhl_express_provider_input'),
  ('20261005020000_published_carrier_catalog'),
  ('20261005030000_provider_carrier_labels'),
  ('20261006000000_merge_retimed_scans'),
  ('20261006010000_letter_only_numbers_and_j_and_t_cargo'),
  ('20261006020000_dhl_express_facility_clocks'),
  ('20261007000000_dhl_ecommerce_national_networks'),
  ('20261007010000_international_dpd_postcode'),
  ('20261007190000_provider_postcode_retries'),
  ('20261008000000_international_mondial_relay_gls_postcode')
on conflict do nothing;

insert into public.applied_migrations (name) values ('20261008010000_applied_migrations')
on conflict do nothing;

notify pgrst, 'reload schema';
