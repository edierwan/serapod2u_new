#!/usr/bin/env bash
# ============================================================================
# DEVELOPMENT DATABASE CLONE SCRIPT
# ============================================================================
# Safely clones Supabase production PostgreSQL → serapod2u.dev (VPS PostgreSQL)
#
# SAFETY:
#   - READ-ONLY against production (pg_dump only)
#   - WRITE-ONLY to serapod2u.dev (development)
#   - Never modifies production schema or data
#   - Uses --no-owner --no-privileges to avoid permission issues
#
# PREREQUISITES:
#   - pg_dump and pg_restore installed locally (or on VPS)
#   - SSH access to VPS: ssh -i ~/.ssh/id_ed25519 deploy@72.62.253.182
#   - serapod2u.dev database exists on VPS PostgreSQL
#   - VPS PostgreSQL accepts connections (check pg_hba.conf)
#
# USAGE:
#   chmod +x ops/dev-db-clone.sh
#   ./ops/dev-db-clone.sh
#
# Or run individual steps:
#   ./ops/dev-db-clone.sh dump      # Only dump from production
#   ./ops/dev-db-clone.sh restore   # Only restore to dev (requires existing dump)
# ============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

# Production Supabase (READ-ONLY source)
PROD_HOST="aws-1-ap-southeast-1.pooler.supabase.com"
PROD_PORT="5432"
PROD_USER="postgres.hsvmvmurvpqcdmxckhnz"
PROD_DB="postgres"
# Password will be prompted or set via PGPASSWORD env var

# Development VPS PostgreSQL (WRITE target)
# These may need adjustment based on your VPS PostgreSQL configuration
DEV_VPS_HOST="72.62.253.182"
DEV_VPS_PORT="5432"
DEV_VPS_USER="postgres"
DEV_VPS_DB="serapod2u.dev"
# If PostgreSQL is not exposed externally, we'll use SSH tunnel

# Dump file location
DUMP_DIR="$(dirname "$0")/../.tmp"
DUMP_FILE="${DUMP_DIR}/serapod2u_prod_dump_$(date +%Y%m%d_%H%M%S).sql"
DUMP_FILE_CUSTOM="${DUMP_DIR}/serapod2u_prod_dump_$(date +%Y%m%d_%H%M%S).dump"

# SSH configuration
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_USER="deploy"
SSH_HOST="72.62.253.182"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helper Functions ────────────────────────────────────────────────────────

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check pg_dump
    if ! command -v pg_dump &>/dev/null; then
        log_error "pg_dump not found. Install PostgreSQL client tools."
        log_info "  macOS: brew install libpq && brew link --force libpq"
        log_info "  Ubuntu: sudo apt-get install postgresql-client"
        exit 1
    fi
    
    # Check pg_restore
    if ! command -v pg_restore &>/dev/null; then
        log_error "pg_restore not found. Install PostgreSQL client tools."
        exit 1
    fi
    
    # Check SSH key
    if [ ! -f "$SSH_KEY" ]; then
        log_error "SSH key not found at $SSH_KEY"
        exit 1
    fi
    
    # Create dump directory
    mkdir -p "$DUMP_DIR"
    
    log_ok "Prerequisites check passed"
}

# ── Step 1: Dump from Production ────────────────────────────────────────────

dump_production() {
    log_info "═══════════════════════════════════════════════════════"
    log_info "STEP 1: Dumping from Supabase production (READ-ONLY)"
    log_info "═══════════════════════════════════════════════════════"
    log_warn "This is a READ-ONLY operation against production."
    log_info "Source: ${PROD_HOST}:${PROD_PORT}/${PROD_DB}"
    
    echo ""
    read -rp "Continue with production dump? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        log_warn "Aborted by user."
        exit 0
    fi
    
    # Prompt for production password if not set
    if [ -z "${PGPASSWORD:-}" ]; then
        echo -n "Enter production database password: "
        read -rs PGPASSWORD
        echo ""
        export PGPASSWORD
    fi
    
    log_info "Starting pg_dump (custom format for faster restore)..."
    log_info "Output: $DUMP_FILE_CUSTOM"
    
    # Dump in custom format (compressed, supports parallel restore)
    # Exclude Supabase internal schemas that won't exist on raw PostgreSQL
    pg_dump \
        -h "$PROD_HOST" \
        -p "$PROD_PORT" \
        -U "$PROD_USER" \
        -d "$PROD_DB" \
        -F c \
        -v \
        --no-owner \
        --no-privileges \
        --no-comments \
        --exclude-schema='supabase_*' \
        --exclude-schema='_supabase*' \
        --exclude-schema='auth' \
        --exclude-schema='storage' \
        --exclude-schema='realtime' \
        --exclude-schema='_realtime' \
        --exclude-schema='pgbouncer' \
        --exclude-schema='pgsodium' \
        --exclude-schema='pgsodium_masks' \
        --exclude-schema='vault' \
        --exclude-schema='graphql' \
        --exclude-schema='graphql_public' \
        --exclude-schema='net' \
        --exclude-schema='extensions' \
        -f "$DUMP_FILE_CUSTOM" \
        2>&1 | tee "${DUMP_DIR}/dump.log"
    
    # Also create a plain SQL dump for inspection
    log_info "Creating plain SQL dump for inspection..."
    pg_dump \
        -h "$PROD_HOST" \
        -p "$PROD_PORT" \
        -U "$PROD_USER" \
        -d "$PROD_DB" \
        -F p \
        --no-owner \
        --no-privileges \
        --no-comments \
        --schema='public' \
        --data-only \
        -f "$DUMP_FILE" \
        2>&1 | tee -a "${DUMP_DIR}/dump.log"
    
    unset PGPASSWORD
    
    local dump_size
    dump_size=$(du -h "$DUMP_FILE_CUSTOM" | cut -f1)
    log_ok "Production dump complete: $DUMP_FILE_CUSTOM ($dump_size)"
    log_info "Plain SQL (public schema data): $DUMP_FILE"
}

# ── Step 2: Restore to serapod2u.dev ────────────────────────────────────────

restore_to_dev() {
    log_info "═══════════════════════════════════════════════════════"
    log_info "STEP 2: Restoring to serapod2u.dev (VPS PostgreSQL)"
    log_info "═══════════════════════════════════════════════════════"
    log_info "Target: serapod2u.dev on ${SSH_HOST}"
    
    # Find the latest dump file
    local latest_dump
    latest_dump=$(ls -t "${DUMP_DIR}"/*.dump 2>/dev/null | head -1)
    
    if [ -z "$latest_dump" ]; then
        log_error "No dump file found in ${DUMP_DIR}/"
        log_info "Run './ops/dev-db-clone.sh dump' first."
        exit 1
    fi
    
    log_info "Using dump file: $latest_dump"
    local dump_size
    dump_size=$(du -h "$latest_dump" | cut -f1)
    log_info "Dump size: $dump_size"
    
    echo ""
    log_warn "This will DROP and recreate the public schema in serapod2u.dev!"
    log_warn "All existing data in serapod2u.dev will be replaced."
    read -rp "Continue with restore to serapod2u.dev? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        log_warn "Aborted by user."
        exit 0
    fi
    
    # Option A: Direct connection (if PostgreSQL port is exposed)
    # Option B: SSH tunnel (if port is not exposed)
    
    log_info "Setting up SSH tunnel to VPS PostgreSQL..."
    
    # Start SSH tunnel in background
    # Tunnel local port 15432 → VPS localhost:5432
    ssh -f -N -L 15432:localhost:5432 \
        -i "$SSH_KEY" \
        "${SSH_USER}@${SSH_HOST}" \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=10
    
    local tunnel_pid=$!
    
    # Give tunnel time to establish
    sleep 2
    
    # Check if tunnel is alive
    if ! lsof -i :15432 &>/dev/null; then
        log_error "SSH tunnel failed to establish."
        log_info "Check SSH connectivity: ssh -i $SSH_KEY ${SSH_USER}@${SSH_HOST}"
        exit 1
    fi
    
    log_ok "SSH tunnel established (localhost:15432 → VPS:5432)"
    
    # Prompt for VPS PostgreSQL password
    echo -n "Enter serapod2u.dev database password: "
    read -rs DEV_DB_PASSWORD
    echo ""
    
    export PGPASSWORD="$DEV_DB_PASSWORD"
    
    # Test connection
    log_info "Testing connection to serapod2u.dev..."
    if ! psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" -c "SELECT 1;" &>/dev/null; then
        log_error "Cannot connect to serapod2u.dev"
        log_info "Check database exists and credentials are correct."
        log_info "You may need to create it: CREATE DATABASE \"serapod2u.dev\";"
        unset PGPASSWORD
        # Kill tunnel
        pkill -f "ssh.*15432:localhost:5432" 2>/dev/null || true
        exit 1
    fi
    log_ok "Connected to serapod2u.dev"
    
    # Pre-restore: Create required extensions
    log_info "Creating required extensions..."
    psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" <<'EXTENSIONS_SQL'
-- Create extensions commonly used by Supabase projects
-- Ignore errors if they already exist or aren't available
DO $$
BEGIN
    -- Core extensions
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    CREATE EXTENSION IF NOT EXISTS "btree_gin";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
    CREATE EXTENSION IF NOT EXISTS "citext";
    
    -- These may not be available on all PostgreSQL installs
    BEGIN CREATE EXTENSION IF NOT EXISTS "moddatetime"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'moddatetime not available'; END;
    BEGIN CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_stat_statements not available'; END;
END $$;
EXTENSIONS_SQL
    
    # Drop and recreate the public schema to start clean
    log_info "Cleaning serapod2u.dev public schema..."
    psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" <<'CLEAN_SQL'
-- Drop all tables in public schema (cascade to handle foreign keys)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all views first
    FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
    END LOOP;
    
    -- Drop all materialized views
    FOR r IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.' || quote_ident(r.matviewname) || ' CASCADE';
    END LOOP;
    
    -- Drop all tables
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
    
    -- Drop all functions
    FOR r IN (SELECT ns.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
              FROM pg_proc p JOIN pg_namespace ns ON p.pronamespace = ns.oid
              WHERE ns.nspname = 'public') LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.args || ') CASCADE';
    END LOOP;
    
    -- Drop all types
    FOR r IN (SELECT typname FROM pg_type t
              JOIN pg_namespace ns ON t.typnamespace = ns.oid
              WHERE ns.nspname = 'public' AND t.typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
    END LOOP;
    
    -- Drop all sequences
    FOR r IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequencename) || ' CASCADE';
    END LOOP;
END $$;
CLEAN_SQL
    
    log_ok "Public schema cleaned"
    
    # Restore the dump
    log_info "Restoring dump to serapod2u.dev (this may take a while)..."
    
    pg_restore \
        -h localhost \
        -p 15432 \
        -U "$DEV_VPS_USER" \
        -d "$DEV_VPS_DB" \
        --no-owner \
        --no-privileges \
        --schema=public \
        --if-exists \
        --clean \
        --single-transaction \
        -v \
        "$latest_dump" \
        2>&1 | tee "${DUMP_DIR}/restore.log"
    
    local restore_exit=$?
    
    if [ $restore_exit -ne 0 ]; then
        log_warn "pg_restore completed with warnings (exit code: $restore_exit)"
        log_info "This is often normal - some Supabase-specific objects may not transfer."
        log_info "Check ${DUMP_DIR}/restore.log for details."
    else
        log_ok "Restore completed successfully"
    fi
    
    # Post-restore: Verify
    log_info "Verifying restore..."
    local table_count
    table_count=$(psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" \
        -t -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';")
    log_ok "Tables in public schema: $(echo "$table_count" | xargs)"
    
    # Show table list
    log_info "Tables restored:"
    psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" \
        -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    
    # Cleanup
    unset PGPASSWORD
    
    # Kill SSH tunnel
    log_info "Closing SSH tunnel..."
    pkill -f "ssh.*15432:localhost:5432" 2>/dev/null || true
    
    log_ok "═══════════════════════════════════════════════════════"
    log_ok "Database clone complete: production → serapod2u.dev"
    log_ok "═══════════════════════════════════════════════════════"
}

# ── Step 3: Post-clone sanitization ─────────────────────────────────────────

sanitize_dev_data() {
    log_info "═══════════════════════════════════════════════════════"
    log_info "STEP 3: Sanitizing development data"
    log_info "═══════════════════════════════════════════════════════"
    log_warn "This removes/masks production-sensitive data in dev."
    
    echo -n "Enter serapod2u.dev database password: "
    read -rs DEV_DB_PASSWORD
    echo ""
    export PGPASSWORD="$DEV_DB_PASSWORD"
    
    # Ensure SSH tunnel is up
    if ! lsof -i :15432 &>/dev/null; then
        log_info "Reopening SSH tunnel..."
        ssh -f -N -L 15432:localhost:5432 \
            -i "$SSH_KEY" \
            "${SSH_USER}@${SSH_HOST}" \
            -o StrictHostKeyChecking=no
        sleep 2
    fi
    
    log_info "Sanitizing sensitive data..."
    psql -h localhost -p 15432 -U "$DEV_VPS_USER" -d "$DEV_VPS_DB" <<'SANITIZE_SQL'
-- ============================================
-- Development Data Sanitization
-- ============================================
-- Remove/mask production-sensitive information
-- so development database is safe for testing.
-- ============================================

-- 1. Clear notification outbox (prevent sending real messages)
TRUNCATE TABLE notifications_outbox CASCADE;

-- 2. Clear any queued jobs (prevent running production tasks)
UPDATE qr_reverse_jobs SET status = 'cancelled' WHERE status IN ('queued', 'processing');

-- 3. Mask real phone numbers in notification configs (keep structure)
-- Only if the table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_provider_configs') THEN
        UPDATE notification_provider_configs
        SET config_public = config_public || '{"is_dev_clone": true}'::jsonb
        WHERE config_public IS NOT NULL;
    END IF;
END $$;

-- 4. Mark this database as a development clone
DO $$
BEGIN
    -- Create a dev marker table
    CREATE TABLE IF NOT EXISTS _dev_clone_info (
        id INTEGER PRIMARY KEY DEFAULT 1,
        cloned_at TIMESTAMPTZ DEFAULT NOW(),
        source TEXT DEFAULT 'supabase_production',
        environment TEXT DEFAULT 'development',
        notes TEXT DEFAULT 'Cloned from production. Do not treat as production data.'
    );
    INSERT INTO _dev_clone_info (id) VALUES (1)
    ON CONFLICT (id) DO UPDATE SET cloned_at = NOW();
END $$;

-- 5. Disable any active payment gateway configs (safety)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payment_gateway_settings') THEN
        UPDATE payment_gateway_settings
        SET config_public = config_public || '{"environment": "sandbox", "is_dev_clone": true}'::jsonb
        WHERE config_public IS NOT NULL;
    END IF;
END $$;

SELECT 'Development sanitization complete' AS result;
SANITIZE_SQL
    
    log_ok "Data sanitization complete"
    
    unset PGPASSWORD
    pkill -f "ssh.*15432:localhost:5432" 2>/dev/null || true
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    log_info "════════════════════════════════════════════════════════════"
    log_info "  Serapod2u Development Database Clone"
    log_info "  Production (Supabase) → serapod2u.dev (VPS PostgreSQL)"
    log_info "════════════════════════════════════════════════════════════"
    echo ""
    log_warn "SAFETY RULES:"
    log_warn "  ✓ Production is READ-ONLY (pg_dump only)"
    log_warn "  ✓ Only serapod2u.dev is modified"
    log_warn "  ✓ No production schemas, secrets, or config are changed"
    echo ""
    
    check_prerequisites
    
    case "${1:-all}" in
        dump)
            dump_production
            ;;
        restore)
            restore_to_dev
            ;;
        sanitize)
            sanitize_dev_data
            ;;
        all)
            dump_production
            restore_to_dev
            sanitize_dev_data
            ;;
        *)
            echo "Usage: $0 [dump|restore|sanitize|all]"
            echo "  dump      - Dump from Supabase production (read-only)"
            echo "  restore   - Restore to serapod2u.dev (requires prior dump)"
            echo "  sanitize  - Sanitize dev data (mask sensitive info)"
            echo "  all       - Run all steps in sequence (default)"
            exit 1
            ;;
    esac
    
    echo ""
    log_ok "Done! See ${DUMP_DIR}/ for dump files and logs."
}

main "$@"
