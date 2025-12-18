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
