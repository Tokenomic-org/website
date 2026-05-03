#!/usr/bin/env bash
# apply.sh — push infra/cloudflare/*.json to the Cloudflare REST API.
#
# Idempotent: lists existing managed rules (description starts with
# "tkn-managed:"), deletes them, then re-creates from JSON. Dashboard-authored
# rules without that prefix are left alone.
#
# Required env:
#   CF_API_TOKEN     account-scoped token (Zone WAF:Edit, Zone Rate Limiting:Edit,
#                    Email Routing:Edit)
#   CF_ACCOUNT_ID    Cloudflare account id
#   CF_ZONE_ID       zone id for tokenomic.org
#   OPS_ALERT_EMAIL  destination address for the alerts@/postmaster@/abuse@
#                    forward rules (must already be a verified destination
#                    in the Email Routing dashboard)
#
# Flags:
#   --diff           compare live state to JSON. No changes applied. Exit 0
#                    if in sync, exit 2 if any drift is detected (suitable
#                    for CI: `apply.sh --diff || exit $?`).
#   --dry-run        show the curl commands that would run, do not execute.
#
set -euo pipefail

DRIFT=0
note_drift() { DRIFT=1; echo "  DRIFT: $*"; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAF_JSON="${HERE}/waf-rules.json"
EMAIL_JSON="${HERE}/email-routing-rules.json"

DIFF_ONLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --diff)    DIFF_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

require() {
  if [ -z "${!1:-}" ]; then
    echo "missing required env: $1" >&2
    exit 64
  fi
}
require CF_API_TOKEN
require CF_ACCOUNT_ID
require CF_ZONE_ID
require OPS_ALERT_EMAIL

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

cf() {
  local method="$1"; shift
  local path="$1"; shift
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY: curl -X ${method} ${API}${path} $*" >&2
    echo "{}"
    return 0
  fi
  curl -sS --fail-with-body -X "${method}" "${API}${path}" "${AUTH[@]}" "$@"
}

# diff_set — compare two newline-separated sets of canonical descriptions
# and report drift. $1 = live, $2 = desired, $3 = label.
diff_set() {
  local live="$1" desired="$2" label="$3"
  local missing extra
  missing=$(comm -23 <(printf '%s\n' "$desired" | LC_ALL=C sort -u) \
                     <(printf '%s\n' "$live"    | LC_ALL=C sort -u))
  extra=$(comm -13   <(printf '%s\n' "$desired" | LC_ALL=C sort -u) \
                     <(printf '%s\n' "$live"    | LC_ALL=C sort -u))
  if [ -n "$missing" ]; then
    while IFS= read -r m; do note_drift "$label missing in zone: $m"; done <<<"$missing"
  fi
  if [ -n "$extra" ]; then
    while IFS= read -r e; do note_drift "$label present in zone but not in JSON: $e"; done <<<"$extra"
  fi
}

# --- WAF custom rules ---------------------------------------------------------
echo "→ WAF custom rules"
EXISTING=$(cf GET "/zones/${CF_ZONE_ID}/firewall/rules?per_page=100" || echo '{"result":[]}')
LIVE_FW=$(printf '%s' "$EXISTING" | jq -r '.result[] | select(.description // "" | startswith("tkn-managed:")) | .description')
DESIRED_FW=$(jq -r '.rulesets[].rules[].description' "$WAF_JSON")
TO_DELETE=$(printf '%s' "$EXISTING" | jq -r '.result[] | select(.description // "" | startswith("tkn-managed:")) | .id')

if [ "$DIFF_ONLY" -eq 1 ]; then
  diff_set "$LIVE_FW" "$DESIRED_FW" "firewall rule"
else
  for id in $TO_DELETE; do
    cf DELETE "/zones/${CF_ZONE_ID}/firewall/rules/${id}" >/dev/null
    echo "  deleted firewall rule ${id}"
  done
  jq -c '.rulesets[].rules[]' "$WAF_JSON" | while read -r rule; do
    cf POST "/zones/${CF_ZONE_ID}/firewall/rules" --data "[$rule]" >/dev/null
    echo "  created firewall rule: $(printf '%s' "$rule" | jq -r .description)"
  done
fi

# --- Rate-limit rules ---------------------------------------------------------
echo "→ Rate-limit rules"
EXISTING_RL=$(cf GET "/zones/${CF_ZONE_ID}/rate_limits?per_page=100" || echo '{"result":[]}')
LIVE_RL=$(printf '%s' "$EXISTING_RL" | jq -r '.result[] | select(.description // "" | startswith("tkn-managed:")) | .description')
DESIRED_RL=$(jq -r '.rate_limits[].description' "$WAF_JSON")
TO_DELETE_RL=$(printf '%s' "$EXISTING_RL" | jq -r '.result[] | select(.description // "" | startswith("tkn-managed:")) | .id')

if [ "$DIFF_ONLY" -eq 1 ]; then
  diff_set "$LIVE_RL" "$DESIRED_RL" "rate-limit"
else
  for id in $TO_DELETE_RL; do
    cf DELETE "/zones/${CF_ZONE_ID}/rate_limits/${id}" >/dev/null
    echo "  deleted rate-limit ${id}"
  done
  jq -c '.rate_limits[]' "$WAF_JSON" | while read -r rl; do
    cf POST "/zones/${CF_ZONE_ID}/rate_limits" --data "$rl" >/dev/null
    echo "  created rate-limit: $(printf '%s' "$rl" | jq -r .description)"
  done
fi

# --- Email Routing rules ------------------------------------------------------
echo "→ Email Routing rules"
EXISTING_EM=$(cf GET "/zones/${CF_ZONE_ID}/email/routing/rules?per_page=100" || echo '{"result":[]}')
LIVE_EM=$(printf '%s' "$EXISTING_EM" | jq -r '.result[] | select(.name // "" | startswith("tkn-managed:")) | .name')
DESIRED_EM=$(jq -r '.rules[].name' "$EMAIL_JSON")
TO_DELETE_EM=$(printf '%s' "$EXISTING_EM" | jq -r '.result[] | select(.name // "" | startswith("tkn-managed:")) | .tag')

if [ "$DIFF_ONLY" -eq 1 ]; then
  diff_set "$LIVE_EM" "$DESIRED_EM" "email rule"
  # Catch-all drift: live action vs desired action.
  LIVE_CATCH=$(cf GET "/zones/${CF_ZONE_ID}/email/routing/rules/catch_all" || echo '{}')
  LIVE_CATCH_ACTION=$(printf '%s' "$LIVE_CATCH" | jq -r '.result.actions[0].type // "none"')
  DESIRED_CATCH_ACTION=$(jq -r '.catch_all.actions[0].type' "$EMAIL_JSON")
  if [ "$LIVE_CATCH_ACTION" != "$DESIRED_CATCH_ACTION" ]; then
    note_drift "catch-all action: live=$LIVE_CATCH_ACTION desired=$DESIRED_CATCH_ACTION"
  fi
else
  for tag in $TO_DELETE_EM; do
    cf DELETE "/zones/${CF_ZONE_ID}/email/routing/rules/${tag}" >/dev/null
    echo "  deleted email rule ${tag}"
  done
  # Interpolate ${OPS_ALERT_EMAIL} into the JSON before posting.
  RENDERED=$(jq --arg ops "$OPS_ALERT_EMAIL" '
    .rules |= map(
      .actions |= map(
        if .value? then .value |= map(if . == "${OPS_ALERT_EMAIL}" then $ops else . end) else . end
      )
    )' "$EMAIL_JSON")
  printf '%s' "$RENDERED" | jq -c '.rules[]' | while read -r r; do
    cf POST "/zones/${CF_ZONE_ID}/email/routing/rules" --data "$r" >/dev/null
    echo "  created email rule: $(printf '%s' "$r" | jq -r .name)"
  done
  CATCH=$(printf '%s' "$RENDERED" | jq -c '.catch_all')
  cf PUT "/zones/${CF_ZONE_ID}/email/routing/rules/catch_all" --data "$CATCH" >/dev/null
  echo "  updated catch-all"
fi

if [ "$DIFF_ONLY" -eq 1 ]; then
  if [ "$DRIFT" -eq 0 ]; then
    echo "✓ in sync"
    exit 0
  else
    echo "✗ drift detected"
    exit 2
  fi
fi

echo "✓ done"
