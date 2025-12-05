#!/bin/bash

# Quick script to apply migration using psql
# Reads from app/.env.local and applies the migration

set -e

echo "🚀 Applying Inventory Allocation Migration..."
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if migration file exists
MIGRATION_FILE="$SCRIPT_DIR/supabase/migrations/086_add_inventory_allocation_functions.sql"
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

# Read database URL from .env.local
ENV_FILE="$SCRIPT_DIR/app/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Environment file not found: $ENV_FILE"
    exit 1
fi

# Extract DATABASE_POOL_URL
DATABASE_URL=$(grep "DATABASE_POOL_URL" "$ENV_FILE" | cut -d '=' -f2- | tr -d ' ' | tr -d '"' | tr -d "'")

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_POOL_URL not found in $ENV_FILE"
    echo ""
    echo "Please add your database connection string:"
    echo "DATABASE_POOL_URL=postgresql://..."
    exit 1
fi

echo "📋 Migration file: 086_add_inventory_allocation_functions.sql"
echo "🔗 Connecting to database..."
echo ""

# Apply migration using psql
if psql "$DATABASE_URL" -f "$MIGRATION_FILE"; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "🔍 Verifying functions..."
    echo ""
    
    # Verify functions exist
    psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname IN ('allocate_inventory_for_order', 'release_allocation_for_order') ORDER BY proname;" -t
    
    echo ""
    echo "✅ Functions are available!"
    echo ""
    echo "Next steps:"
    echo "1. Restart your dev server (Ctrl+C, then restart)"
    echo "2. Create a D2H or S2D order"
    echo "3. Check console for: ✅ Inventory allocated successfully"
    echo ""
else
    echo ""
    echo "❌ Migration failed!"
    echo ""
    echo "Alternative: Apply manually via Supabase Dashboard"
    echo "1. Open: https://supabase.com/dashboard/project/bamybvzufxijghzqdytu/sql"
    echo "2. Copy content from: $MIGRATION_FILE"
    echo "3. Paste and click 'Run'"
    echo ""
    exit 1
fi
