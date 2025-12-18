#!/bin/bash

# ===============================================
# Complete Master Data Migration Script
# Source: bamybvzufxijghzqdytu (Production)
# Target: cbqsuzctjotbhxanazhf (New DB)
# ===============================================

set -e

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
echo "Master Data Migration"
echo "Source: bamybvzufxijghzqdytu"
echo "Target: cbqsuzctjotbhxanazhf"
echo "=============================================="
echo ""

# -----------------------------------------------
# Define MASTER DATA tables to migrate
# These are configuration/reference data, NOT transactions
# -----------------------------------------------

# Core Schema Master Tables (all - it's all master data)
CORE_TABLES=(
    "core.companies"
    "core.company_users"
    "core.tenants"
    "core.tenant_members"
    "core.user_profiles"
    "core.system_preferences"
)

# Public Schema - Master/Reference Data Tables
MASTER_TABLES=(
    # Users & Organizations (MASTER)
    "public.users"
    "public.organizations"
    "public.organization_types"
    "public.roles"
    
    # Products & Variants (MASTER)
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
    
    # Geographic Master Data
    "public.regions"
    "public.states"
    "public.districts"
    
    # QR Configuration (Master codes, not QR transactions)
    "public.qr_batches"
    "public.qr_master_codes"
    "public.qr_secret_codes"
    
    # Configuration & Settings
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
    
    # Campaign Configuration (NOT plays/entries)
    "public.daily_quiz_campaigns"
    "public.daily_quiz_questions"
    "public.lucky_draw_campaigns"
    "public.spin_wheel_campaigns"
    "public.spin_wheel_rewards"
    "public.scratch_card_campaigns"
    "public.scratch_card_rewards"
    "public.points_rules"
    "public.point_rewards"
    
    # Redemption Configuration
    "public.redeem_gifts"
    "public.redeem_items"
    "public.redemption_gifts"
    "public.redemption_policies"
    "public.redemption_order_limits"
)

# -----------------------------------------------
# TRANSACTION TABLES - EXCLUDED FROM MIGRATION
# -----------------------------------------------
# These tables contain transactional data and will NOT be migrated:
# - public.orders, public.order_items
# - public.documents, public.document_signatures, public.document_files  
# - public.stock_movements, public.stock_transfers
# - public.stock_adjustments, public.stock_adjustment_items
# - public.stock_adjustment_manufacturer_actions
# - public.product_inventory (runtime state)
# - public.qr_codes (QR serial numbers - transaction)
# - public.qr_movements, public.qr_prepared_codes
# - public.qr_reverse_jobs, public.qr_reverse_job_items, public.qr_reverse_job_logs
# - public.qr_validation_reports
# - public.consumer_activations, public.consumer_qr_scans, public.consumer_feedback
# - public.daily_quiz_plays, public.lucky_draw_entries, public.lucky_draw_order_links
# - public.spin_wheel_plays, public.scratch_card_plays
# - public.points_transactions
# - public.redeem_gift_transactions, public.redemption_orders
# - public.journey_order_links
# - public.audit_logs, public.email_send_log
# - public.notification_logs, public.notifications_outbox
# - public.otp_challenges
# - public.wms_movement_dedup

# -----------------------------------------------
# STEP 1: Dump schema from source
# -----------------------------------------------
echo "STEP 1: Dumping schema from source database..."
echo "------------------------------------------------"

pg_dump \
    -h "$SOURCE_HOST" \
    -p "$PORT" \
    -U "$SOURCE_USER" \
    -d "$DB_NAME" \
    --schema-only \
    --no-owner \
    --no-privileges \
    -n public \
    -n core \
    -f "$DUMP_DIR/01_schema.sql"

echo "✓ Schema dump: $DUMP_DIR/01_schema.sql"

# -----------------------------------------------
# STEP 2: Dump auth.users data (required for FK)
# -----------------------------------------------
echo ""
echo "STEP 2: Checking auth.users..."
echo "------------------------------------------------"

# Note: auth.users is managed by Supabase, we need to handle it specially
# The public.users table typically references auth.users

psql -h "$SOURCE_HOST" -p "$PORT" -U "$SOURCE_USER" -d "$DB_NAME" -c "SELECT id, email FROM auth.users LIMIT 5;" 2>&1 || echo "Note: Cannot directly access auth.users (managed by Supabase)"

# -----------------------------------------------
# STEP 3: Build table arguments for data dump
# -----------------------------------------------
echo ""
echo "STEP 3: Dumping master data..."
echo "------------------------------------------------"

# Build table arguments
TABLE_ARGS=""
for table in "${CORE_TABLES[@]}"; do
    TABLE_ARGS="$TABLE_ARGS -t $table"
done
for table in "${MASTER_TABLES[@]}"; do
    TABLE_ARGS="$TABLE_ARGS -t $table"
done

echo "Tables to migrate:"
for table in "${CORE_TABLES[@]}" "${MASTER_TABLES[@]}"; do
    COUNT=$(psql -h "$SOURCE_HOST" -p "$PORT" -U "$SOURCE_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM $table" 2>/dev/null || echo "0")
    echo "  - $table: $COUNT rows"
done

# Dump data only
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
    -f "$DUMP_DIR/02_master_data.sql"

echo ""
echo "✓ Master data dump: $DUMP_DIR/02_master_data.sql"
echo "  Size: $(du -h "$DUMP_DIR/02_master_data.sql" | cut -f1)"

# -----------------------------------------------
# STEP 4: Create import script
# -----------------------------------------------
echo ""
echo "STEP 4: Creating import script..."
echo "------------------------------------------------"

cat > "$DUMP_DIR/03_import.sh" << 'IMPORT_EOF'
#!/bin/bash
set -e

export PGPASSWORD='Turun_2020-'
TARGET_HOST="aws-1-ap-southeast-1.pooler.supabase.com"
TARGET_USER="postgres.cbqsuzctjotbhxanazhf"
PORT="5432"
DB_NAME="postgres"
DUMP_DIR="./migration_dumps"

echo "Importing to target database: cbqsuzctjotbhxanazhf"
echo "==================================================="

# Step 1: Import schema
echo ""
echo "Step 1: Importing schema..."
psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -f "$DUMP_DIR/01_schema.sql" 2>&1 || true

# Step 2: Disable triggers for data import
echo ""
echo "Step 2: Disabling triggers..."
psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -c "SET session_replication_role = 'replica';"

# Step 3: Import data
echo ""
echo "Step 3: Importing master data..."
psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -f "$DUMP_DIR/02_master_data.sql" 2>&1

# Step 4: Re-enable triggers
echo ""
echo "Step 4: Re-enabling triggers..."
psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -c "SET session_replication_role = 'origin';"

echo ""
echo "✓ Import complete!"
IMPORT_EOF

chmod +x "$DUMP_DIR/03_import.sh"
echo "✓ Import script created: $DUMP_DIR/03_import.sh"

# -----------------------------------------------
# Summary
# -----------------------------------------------
echo ""
echo "=============================================="
echo "MIGRATION FILES READY"
echo "=============================================="
echo ""
echo "Files created in $DUMP_DIR/:"
ls -la "$DUMP_DIR/"
echo ""
echo "To complete migration, run:"
echo "  cd $DUMP_DIR && ./03_import.sh"
echo ""
echo "Or manually:"
echo "  1. Import schema:"
echo "     psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.cbqsuzctjotbhxanazhf -d postgres -f $DUMP_DIR/01_schema.sql"
echo ""
echo "  2. Import data:"
echo "     psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.cbqsuzctjotbhxanazhf -d postgres -f $DUMP_DIR/02_master_data.sql"
echo ""
