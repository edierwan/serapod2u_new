#!/bin/bash

# Quick script to apply migration using psql
# Reads from app/.env.local and applies the migration

set -e

echo "🚀 Applying Fix Inventory Logic Migration..."
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if migration file exists
MIGRATION_FILE="$SCRIPT_DIR/supabase/migrations/088_fix_inventory_logic.sql"
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

echo "📋 Migration file: 088_fix_inventory_logic.sql"
echo "🔗 Connecting to database..."
echo ""

# Apply migration using psql
if psql "$DATABASE_URL" -f "$MIGRATION_FILE"; then
    echo ""
    echo "✅ Migration applied successfully!"
else
    echo ""
    echo "❌ Failed to apply migration"
    exit 1
fi
