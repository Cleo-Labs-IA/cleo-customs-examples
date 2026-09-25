#!/usr/bin/env bash
# Quickstart: one classification call with curl.
#
# Pain: "I only have a product title." A bare "T-shirt" for the United States
# comes back `needs_information` with the questions to ask your supplier,
# instead of an invented code.
#
#   export CLEO_API_KEY=...          # https://cleo-legal-public.vercel.app/signup
#   bash curl/quickstart.sh
#
# Needs curl and jq. Nothing is stored (persist defaults to false). Cost: 1 unit.
set -euo pipefail

BASE_URL="${CLEO_BASE_URL:-https://api.legaldata.cleolabs.co}"
BASE_URL="${BASE_URL%/}"

fail() { echo "FAIL: $*" >&2; exit 1; }
command -v jq >/dev/null || fail "jq is required (https://jqlang.org/download/)"
[ -n "${CLEO_API_KEY:-}" ] || fail "CLEO_API_KEY is not set. Create a key at https://cleo-legal-public.vercel.app/signup"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

status="$(curl -sS -o "$tmp/body.json" -D "$tmp/headers.txt" -w '%{http_code}' \
  -X POST "$BASE_URL/v2/customs/classifications" \
  -H "Authorization: Bearer $CLEO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"item_id":"SKU-TSHIRT-9","description":"T-shirt","country":"US"}')"

request_id="$(grep -i '^x-request-id:' "$tmp/headers.txt" | tail -1 | cut -d' ' -f2- | tr -d '\r')"
echo "[evidence] POST /v2/customs/classifications http=$status request_id=${request_id:-MISSING} base=$BASE_URL"

[ "$status" = "200" ] || fail "expected HTTP 200, got $status: $(head -c 300 "$tmp/body.json")"
[ -n "$request_id" ] || fail "the response carries no X-Request-Id header"

jq -e '.data.status == "needs_information"' "$tmp/body.json" >/dev/null \
  || fail "expected status needs_information, got $(jq -r '.data.status' "$tmp/body.json")"
jq -e '(.data.questions | length) > 0' "$tmp/body.json" >/dev/null \
  || fail "needs_information must come with at least one question"
jq -e '[.data.missing_attributes[] as $a | [.data.questions[].fact] | index($a)] | all' "$tmp/body.json" >/dev/null \
  || fail "a missing attribute has no matching question"
jq -e '.data | has("classification_id") | not' "$tmp/body.json" >/dev/null \
  || fail "persist was not requested, yet a classification_id came back"

jq -r '"status: \(.data.status)", (.data.questions[] | "- \(.fact) (\(.discriminates)): \(.question)")' "$tmp/body.json"
echo "PASS: needs_information with $(jq '.data.questions | length' "$tmp/body.json") question(s)"
