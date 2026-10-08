#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
database_url=${TEST_DATABASE_URL:-}

if [[ -z "$database_url" ]]; then
  echo "TEST_DATABASE_URL is required" >&2
  exit 2
fi

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/bootstrap.sql"

while IFS= read -r migration; do
  if [[ "$(basename "$migration")" == "20260715000000_shared_backend.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_shared_backend.sql"
  fi
  if [[ "$(basename "$migration")" == "20260805200000_restore_user_ownership.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_restore_user_ownership.sql"
  fi
  if [[ "$(basename "$migration")" == "20260806130000_fix_to_be_delivered_stage.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_fix_to_be_delivered_stage.sql"
  fi
  if [[ "$(basename "$migration")" == "20260825160000_delivery_live_activities.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_notification_event_times.sql"
  fi
  if [[ "$(basename "$migration")" == "20260901210000_add_india_post.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_india_post.sql"
  fi
  if [[ "$(basename "$migration")" == "20260911150000_short_invitation_previews.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_short_invitation_previews.sql"
  fi
  if [[ "$(basename "$migration")" == "20260911180000_keep_previous_invitations.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_multiple_invitations.sql"
  fi
  if [[ "$(basename "$migration")" == "20261002120000_parcel_sharing.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_parcel_sharing.sql"
  fi
  if [[ "$(basename "$migration")" == "20261005030000_provider_carrier_labels.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_provider_carrier_labels.sql"
  fi
  if [[ "$(basename "$migration")" == "20261008050000_review_queue_replays.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/pre_review_queue_replays.sql"
  fi
  psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$migration"
  if [[ "$(basename "$migration")" == "20261008050000_review_queue_replays.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/review_queue_replays.sql"
  fi
  if [[ "$(basename "$migration")" == "20261005030000_provider_carrier_labels.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/provider_carrier_labels.sql"
  fi
  if [[ "$(basename "$migration")" == "20260911150000_short_invitation_previews.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/short_invitation_previews.sql"
  fi
  if [[ "$(basename "$migration")" == "20261002120000_parcel_sharing.sql" ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
      -f "$repo_root/supabase/tests/parcel_sharing_upgrade.sql"
  fi
done < <(find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

# A deployment asks production which migrations it lacks, so each one must record itself.
unrecorded=$(comm -23 \
  <(find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -exec basename {} .sql \; | sort) \
  <(psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c 'select name from public.applied_migrations order by name' | sort))
if [[ -n "$unrecorded" ]]; then
  echo "These migrations do not end by recording themselves:" >&2
  sed "s/.*/  insert into public.applied_migrations (name) values ('&') on conflict do nothing;/" <<< "$unrecorded" >&2
  exit 1
fi

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/assertions.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/tracking_sync.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/india_post_flights.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/changed_scan_details.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/retimed_scans.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/dhl_express_facility_clocks.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/planzer_event_stages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/notification_event_times.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/notification_locales.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/friends.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/friendship_receipts.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/sync_job_leases.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/live_activity_revocation.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/multiple_invitations.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/standalone_invitations.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/invitation_outcomes.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/friend_passport_stamps.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/carrier_history_stages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/linked_tracking.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/automatic_links.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/tracking_routing.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/audited_tracking_stages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/proofread_tracking_stages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/refined_tracking_stages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/planzer_delivered_wording.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/amazon_shipping.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/ems.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/tracking_status_observations.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/exception_stage.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/tracking_health.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/tracking_support_cases.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/parcel_links.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/parcel_sharing.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/gift_messages.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/delivery_emails.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/unwatched_parcels.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/omgo.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/account_tracking_budgets.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/native_lookup_verification.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/dhl_express_provider_input.sql"

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/published_carrier_catalog.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/letter_only_numbers_and_j_and_t_cargo.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/dhl_ecommerce_national_networks.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/international_dpd_postcode.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/international_mondial_relay_gls_postcode.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/seventeentrack_india_post_copies.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/universal_clock_copies.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/remaining_scan_copies.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/delivery_notice_and_relay_hub_stages.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/la_poste_round_sort_stage.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/link_timeline_sources.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/on_screen_deliveries.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/scraper_status_gaps.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/applied_migrations.sql"
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/tests/unchanged_tracking_checks.sql"
