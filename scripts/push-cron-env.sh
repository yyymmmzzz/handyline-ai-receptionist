#!/usr/bin/env bash
#
# push-cron-env.sh — push the two env vars the keepalive cron needs into Vercel.
#
# Why these two:
#   CRON_SECRET            — enables the self-heal (restore) stage of
#                            /api/cron/keepalive, and it is also what makes
#                            /api/cron/emergency-retry require auth. Without
#                            it that endpoint is publicly callable.
#   SUPABASE_ACCESS_TOKEN  — the Supabase personal access token, needed to call
#                            the Management API restore endpoint. Read from
#                            .env.local, never hardcoded here.
#
# Requires an authenticated Vercel CLI:  npx vercel login
#
# Usage:  ./scripts/push-cron-env.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
PROJECT_REF="prj_uVTUUJuMqenAxleB1K7aw1tS2PK2"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  exit 1
fi

read_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//'
}

CRON_SECRET="$(read_env CRON_SECRET)"
SUPABASE_ACCESS_TOKEN="$(read_env SUPABASE_ACCESS_TOKEN)"

if [ -z "$CRON_SECRET" ]; then
  echo "✗ CRON_SECRET missing from .env.local"
  exit 1
fi
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "✗ SUPABASE_ACCESS_TOKEN missing from .env.local"
  exit 1
fi

echo "→ Pushing 2 env vars to Vercel project $PROJECT_REF"
echo

printf '%s' "$CRON_SECRET"            | npx vercel env add CRON_SECRET           production --force --sensitive
printf '%s' "$SUPABASE_ACCESS_TOKEN"  | npx vercel env add SUPABASE_ACCESS_TOKEN production --force --sensitive

echo
echo "✓ Done. Redeploy is not required — env changes apply to the next cold start."
echo "  Verify with:"
echo "    curl -H \"Authorization: Bearer \$CRON_SECRET\" \\"
echo "      https://demo-navy-chi-47.vercel.app/api/cron/keepalive"
echo "  Expect: {\"ok\":true,\"stage\":\"keepalive\",...,\"restoreEnabled\":true}"
