#!/usr/bin/env bash
set -euo pipefail

base_url=${1:-}
if [[ -z "$base_url" ]]; then
  echo "Usage: $0 https://delivery.example.com" >&2
  exit 2
fi
base_url=${base_url%/}

curl_args=(
  --silent
  --show-error
  --max-time 20
  -H 'Cache-Control: no-cache'
)
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" || -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  if [[ -z "${CF_ACCESS_CLIENT_ID:-}" || -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
    echo "Both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required" >&2
    exit 2
  fi
  curl_args+=(
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
  )
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
nonce=$(date +%s)-$$

request() {
  local url=$1
  local output=$2
  local response_headers=$3
  local expected_status=${4:-200}
  local status
  status=$(curl "${curl_args[@]}" \
    -D "$response_headers" \
    -o "$output" \
    -w '%{http_code}' \
    "$url")
  if [[ "$status" != "$expected_status" ]]; then
    echo "Smoke request returned HTTP $status for $url" >&2
    exit 1
  fi
}

require_match() {
  local pattern=$1
  local file=$2
  local message=$3
  local flags=${4:--Eq}
  if ! grep "$flags" "$pattern" "$file"; then
    echo "Smoke check failed: $message" >&2
    exit 1
  fi
}

request "$base_url/?smoke=$nonce" "$workdir/index.html" "$workdir/index.headers"
require_match '/_next/static/[^" ]+\.js' "$workdir/index.html" 'app JavaScript is missing'
require_match '<meta property="og:image" content="https?://[^" ]+/og\.png(\?[^" ]*)?"' "$workdir/index.html" 'social image metadata is missing or invalid'
require_match '^cache-control:.*no-store' "$workdir/index.headers" 'the page must not be cached' -Eiq

request "$base_url/health/live?smoke=$nonce" "$workdir/live.json" "$workdir/live.headers"
expected_ready=${SMOKE_EXPECT_READY:-true}
if [[ "$expected_ready" == true ]]; then
  expected_status=200
elif [[ "$expected_ready" == false ]]; then
  expected_status=503
else
  echo "SMOKE_EXPECT_READY must be true or false" >&2
  exit 2
fi
request "$base_url/health?smoke=$nonce" "$workdir/health.json" "$workdir/health.headers" "$expected_status"
require_match "\"ok\"[[:space:]]*:[[:space:]]*$expected_ready" "$workdir/health.json" 'readiness does not match the expected state'

request "$base_url/og.png" "$workdir/og.png" "$workdir/og.headers"
require_match '^content-type:[[:space:]]*image/png' "$workdir/og.headers" 'the social image must be a PNG' -Eiq

echo "Origin smoke passed for $base_url"
