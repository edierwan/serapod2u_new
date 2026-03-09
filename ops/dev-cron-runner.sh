#!/usr/bin/env bash
# ============================================================================
# Development Cron Scheduler for Coolify
# ============================================================================
# Replaces Vercel Cron for local/VPS development deployments.
#
# Vercel crons are defined in vercel.json and only work on Vercel.
# On Coolify, we use this script with system cron or Coolify Scheduled Tasks.
#
# SETUP (Coolify Scheduled Tasks):
#   In Coolify → Application → Scheduled Tasks, add:
#
#   Name:     dev-cron-workers
#   Schedule: */1 * * * *
#   Command:  /bin/bash /app/ops/dev-cron-runner.sh
#
# OR add to system crontab on VPS:
#   * * * * * /path/to/ops/dev-cron-runner.sh >> /tmp/serapod2u-cron.log 2>&1
#
# SAFETY:
#   - Uses dev-only CRON_SECRET
#   - Only targets dev.serapod2u.com
#   - Never hits production URLs
# ============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

# IMPORTANT: Must match the CRON_SECRET in Coolify environment variables
CRON_SECRET="${CRON_SECRET:-84bf2b36d4ea9930f4f7b67382c7e94302f6c229a74e97f5508dbf770181b753}"

# Development app URL — NEVER use production URL here
DEV_BASE_URL="${NEXT_PUBLIC_APP_URL:-https://dev.serapod2u.com}"

# Safety check: prevent pointing to production
if echo "$DEV_BASE_URL" | grep -qE '^https://(www\.)?serapod2u\.com' && ! echo "$DEV_BASE_URL" | grep -q 'dev\.'; then
    echo "[CRON] BLOCKED: DEV_BASE_URL points to production ($DEV_BASE_URL)"
    exit 1
fi

# ── Cron Jobs ──────────────────────────────────────────────────────────────
# Mirror of vercel.json crons, targeting dev only

ENDPOINTS=(
    "/api/cron/qr-reverse-worker"
    "/api/cron/qr-generation-worker"
    "/api/cron/manufacturer-packing-worker"
    "/api/cron/notification-outbox-worker"
)

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

for endpoint in "${ENDPOINTS[@]}"; do
    url="${DEV_BASE_URL}${endpoint}"

    # Fire and forget with timeout
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 30 \
        -H "Authorization: Bearer ${CRON_SECRET}" \
        "$url" 2>/dev/null || echo "000")

    if [ "$response" = "200" ]; then
        echo "[CRON] ${TIMESTAMP} OK ${endpoint}"
    else
        echo "[CRON] ${TIMESTAMP} FAIL ${endpoint} (HTTP ${response})"
    fi
done
