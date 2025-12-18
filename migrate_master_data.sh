#!/bin/bash

# ===============================================
# Master Data Migration Script
# Source: bamybvzufxijghzqdytu
# Target: cbqsuzctjotbhxanazhf
# ===============================================

# Database credentials
export PGPASSWORD='Turun_2020-'
SOURCE_HOST="aws-1-ap-southeast-1.pooler.supabase.com"
SOURCE_USER="postgres.bamybvzufxijghzqdytu"
TARGET_USER="postgres.cbqsuzctjotbhxanazhf"
PORT="5432"
DB_NAME="postgres"

# Output directory
DUMP_DIR="./migration_dumps"
mkdir -p "$DUMP_DIR"

echo "=============================================="
echo "Master Data Migration: bamybvzufxijghzqdytu -> cbqsuzctjotbhxanazhf"
echo "=============================================="

# -----------------------------------------------
# MASTER DATA TABLES (to be migrated)
# -----------------------------------------------

# Core Schema - Master Data
CORE_MASTER_TABLES=(
    "core.companies"
    "core.company_users"
    "core.tenants"
    "core.tenant_members"
    "core.user_profiles"
    "core.system_preferences"
)

# Public Schema - Master Data Tables
# Users & Organizations
USER_ORG_TABLES=(
    "public.users"
    "public.organizations"
    "public.organization_types"
    "public.roles"
)

# Product Master Data
PRODUCT_TABLES=(
    "public.products"
    "public.product_variants"
    "public.product_categories"
    "public.product_groups"
    "public.product_subgroups"
    "public.product_attributes"
    "public.product_images"
    "public.product_pricing"
    "public.product_skus"
    "public.brands"
    "public.distributor_products"
)

# Geographic Master Data
GEO_TABLES=(
    "public.regions"
    "public.states"
    "public.districts"
)

# QR & Batch Configuration (Master)
QR_MASTER_TABLES=(
    "public.qr_batches"
    "public.qr_master_codes"
    "public.qr_secret_codes"
)

# Settings & Configuration
CONFIG_TABLES=(
    "public.payment_terms"
    "public.message_templates"
    "public.notification_types"
    "public.notification_settings"
    "public.notification_provider_configs"
    "public.org_notification_settings"
    "public.doc_counters"
    "public.shop_distributors"
    "public.stock_adjustment_reasons"
    "public.journey_configurations"
)

# Campaign Configuration (Master - NOT plays/entries)
CAMPAIGN_CONFIG_TABLES=(
    "public.daily_quiz_campaigns"
    "public.daily_quiz_questions"
    "public.lucky_draw_campaigns"
    "public.spin_wheel_campaigns"
    "public.spin_wheel_rewards"
    "public.scratch_card_campaigns"
    "public.scratch_card_rewards"
    "public.points_rules"
    "public.point_rewards"
)

# Redemption Configuration
REDEMPTION_CONFIG_TABLES=(
    "public.redeem_gifts"
    "public.redeem_items"
    "public.redemption_gifts"
    "public.redemption_policies"
    "public.redemption_order_limits"
)

# -----------------------------------------------
# TRANSACTION TABLES (NOT to be migrated)
# -----------------------------------------------
# These are EXCLUDED:
# - public.orders
# - public.order_items
# - public.documents
# - public.document_signatures
# - public.document_files
# - public.stock_movements
# - public.stock_transfers
# - public.stock_adjustments
# - public.stock_adjustment_items
# - public.product_inventory (runtime state)
# - public.qr_codes (transaction/serial data)
# - public.qr_movements
# - public.qr_prepared_codes
# - public.qr_validation_reports
# - public.qr_reverse_jobs (and related)
# - public.consumer_activations
# - public.consumer_qr_scans
# - public.consumer_feedback
# - public.daily_quiz_plays
# - public.lucky_draw_entries
# - public.lucky_draw_order_links
# - public.spin_wheel_plays
# - public.scratch_card_plays
# - public.points_transactions
# - public.redeem_gift_transactions
# - public.redemption_orders
# - public.journey_order_links
# - public.audit_logs
# - public.email_send_log
# - public.notification_logs
# - public.notifications_outbox
# - public.otp_challenges
# - public.wms_movement_dedup

# -----------------------------------------------
# Combine all master tables
# -----------------------------------------------
ALL_MASTER_TABLES=(
    "${CORE_MASTER_TABLES[@]}"
    "${USER_ORG_TABLES[@]}"
    "${PRODUCT_TABLES[@]}"
    "${GEO_TABLES[@]}"
    "${QR_MASTER_TABLES[@]}"
    "${CONFIG_TABLES[@]}"
    "${CAMPAIGN_CONFIG_TABLES[@]}"
    "${REDEMPTION_CONFIG_TABLES[@]}"
)

# Build table list for pg_dump
TABLE_ARGS=""
for table in "${ALL_MASTER_TABLES[@]}"; do
    TABLE_ARGS="$TABLE_ARGS -t $table"
done

echo ""
echo "Tables to migrate:"
echo "-------------------"
for table in "${ALL_MASTER_TABLES[@]}"; do
    echo "  - $table"
done

echo ""
echo "Step 1: Dumping master data from source database..."
echo "---------------------------------------------------"

# Dump data only (no schema, with inserts)
pg_dump \
    -h "$SOURCE_HOST" \
    -p "$PORT" \
    -U "$SOURCE_USER" \
    -d "$DB_NAME" \
    --data-only \
    --disable-triggers \
    --column-inserts \
    --on-conflict-do-nothing \
    $TABLE_ARGS \
    -f "$DUMP_DIR/master_data_dump.sql"

if [ $? -eq 0 ]; then
    echo "✓ Dump completed successfully: $DUMP_DIR/master_data_dump.sql"
    echo "  Size: $(du -h "$DUMP_DIR/master_data_dump.sql" | cut -f1)"
else
    echo "✗ Dump failed!"
    exit 1
fi

echo ""
echo "Step 2: Review dump file before import"
echo "---------------------------------------"
echo "Dump file location: $DUMP_DIR/master_data_dump.sql"
echo ""
echo "Lines in dump: $(wc -l < "$DUMP_DIR/master_data_dump.sql")"
echo ""
echo "Preview (first 50 lines):"
head -50 "$DUMP_DIR/master_data_dump.sql"

echo ""
echo "=============================================="
echo "READY TO IMPORT TO TARGET DATABASE"
echo "=============================================="
echo ""
echo "To import, run:"
echo ""
echo "  export PGPASSWORD='Turun_2020-'"
echo "  psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.cbqsuzctjotbhxanazhf -d postgres -f $DUMP_DIR/master_data_dump.sql"
echo ""
echo "Or run this script with --import flag:"
echo "  ./migrate_master_data.sh --import"
echo ""

# Check if --import flag is provided
if [ "$1" == "--import" ]; then
    echo "Step 3: Importing to target database..."
    echo "----------------------------------------"
    
    psql \
        -h "$SOURCE_HOST" \
        -p "$PORT" \
        -U "$TARGET_USER" \
        -d "$DB_NAME" \
        -f "$DUMP_DIR/master_data_dump.sql"
    
    if [ $? -eq 0 ]; then
        echo "✓ Import completed successfully!"
    else
        echo "✗ Import failed!"
        exit 1
    fi
fi
