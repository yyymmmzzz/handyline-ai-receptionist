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
# THE WHOLE THING IS TWO COMMANDS:
#
#   npx vercel login          # prints a link, approve it in your browser
#   ./scripts/push-cron-env.sh
#
# Usage:
#   ./scripts/push-cron-env.sh              # push the two vars
#   ./scripts/push-cron-env.sh --redeploy   # push them AND redeploy (needed
#                                           # for the running app to see them)
#   ./scripts/push-cron-env.sh --verify     # just check the current state
#
# Notes:
#   - Vercel bakes env vars into each deployment, so adding them does not
#     change the currently live deployment. Use --redeploy (or push any commit)
#     to roll a new deployment that has them.
#   - The values are never printed and never leave .env.local except as
#     Vercel env vars.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
PROJECT_NAME="demo"
# Host only — the scheme is added where the URL is built.
APP_HOST="${NEXT_PUBLIC_APP_URL:-demo-navy-chi-47.vercel.app}"
APP_HOST="${APP_HOST#https://}"
APP_HOST="${APP_HOST#http://}"
APP_HOST="${APP_HOST%/}"

MODE="${1:-}"

read_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//'
}

# ---------------------------------------------------------------- verify only
if [ "$MODE" = "--verify" ]; then
  CRON_SECRET="$(read_env CRON_SECRET)"
  echo "→ Checking https://$APP_HOST/api/cron/keepalive"
  curl -sS --http1.1 --max-time 60 -H "Authorization: Bearer $CRON_SECRET" \
    "https://$APP_HOST/api/cron/keepalive"
  echo
  exit 0
fi

# ------------------------------------------------------------------ preflight
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  exit 1
fi

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

echo "→ Checking Vercel login…"
if ! npx --yes vercel@latest whoami >/dev/null 2>&1; then
  echo "✗ Not logged in to Vercel."
  echo
  echo "  Run this once, then come back:"
  echo
  echo "      npx vercel login"
  echo
  echo "  It prints a URL like https://vercel.com/oauth/device?user_code=XXXX-XXXX"
  echo "  — open it in the browser you are logged into Vercel with and approve."
  echo "  The credentials land in this machine's CLI profile, so afterwards"
  echo "  ./scripts/push-cron-env.sh just works."
  exit 1
fi
echo "  ✓ logged in as $(npx --yes vercel@latest whoami 2>/dev/null | head -1)"

if [ ! -f "$ROOT/.vercel/project.json" ]; then
  echo "→ Project not linked, linking to '$PROJECT_NAME'…"
  npx --yes vercel@latest link --yes --project "$PROJECT_NAME"
fi

# ------------------------------------------------------------------- the push
echo
echo "→ Pushing 2 env vars to Vercel project '$PROJECT_NAME' (production)"
echo

printf '%s' "$CRON_SECRET"           | npx --yes vercel@latest env add CRON_SECRET           production --force --sensitive
printf '%s' "$SUPABASE_ACCESS_TOKEN" | npx --yes vercel@latest env add SUPABASE_ACCESS_TOKEN production --force --sensitive

echo
echo "✓ Env vars pushed."

# ------------------------------------------------------------------ redeploy
if [ "$MODE" = "--redeploy" ]; then
  echo "→ Triggering a redeploy (Vercel bakes env vars per deployment)…"
  cd "$ROOT"
  git commit --allow-empty -m "chore: redeploy so the new env vars take effect"
  git push origin main
  echo "  Pushed. Wait ~2 minutes for the build, then run:"
  echo "      ./scripts/push-cron-env.sh --verify"
  exit 0
fi

echo "→ Verifying…"
sleep 2
curl -sS --http1.1 --max-time 60 -H "Authorization: Bearer $CRON_SECRET" \
  "https://$APP_HOST/api/cron/keepalive"
echo
echo
echo "  If restoreEnabled is still false, the live deployment has not picked the"
echo "  new env vars up yet. Run:"
echo "      ./scripts/push-cron-env.sh --redeploy"
