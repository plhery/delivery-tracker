#!/usr/bin/env bash
# Refuses a deployment whose migrations the database lacks. Migrations are applied by
# hand before the server that needs them, and each one records itself when it runs.
set -euo pipefail

supabase_url=${SUPABASE_URL:-}
supabase_key=${SUPABASE_PUBLISHABLE_KEY:-}
if [[ -z "$supabase_url" || -z "$supabase_key" ]]; then
  echo "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required" >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
names=$(find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -exec basename {} .sql \; \
  | sort | jq -R . | jq -cs '{p_names: .}')

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
status=000
for attempt in 1 2 3; do
  status=$(curl --silent --show-error --max-time 20 -o "$workdir/missing.json" -w '%{http_code}' \
    -X POST "${supabase_url%/}/rest/v1/rpc/missing_migrations" \
    -H "apikey: $supabase_key" -H 'Content-Type: application/json' -d "$names") || status=000
  [[ "$status" == 200 ]] && break
  [[ "$attempt" == 3 ]] || sleep 5
done
if [[ "$status" != 200 ]]; then
  echo "The database did not say which migrations it has (HTTP $status):" >&2
  head -c 500 "$workdir/missing.json" >&2 2>/dev/null || true
  echo >&2
  exit 1
fi

missing=$(jq -r '.[]' "$workdir/missing.json")
if [[ -n "$missing" ]]; then
  echo "Production lacks these migrations. Apply them, then re-run this job:" >&2
  sed 's/^/  /' <<< "$missing" >&2
  exit 1
fi
echo "Production has all $(jq '.p_names | length' <<< "$names") migrations."
