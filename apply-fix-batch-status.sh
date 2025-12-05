#!/bin/bash

# Quick script to apply migration using psql
# Reads from app/.env.local and applies the migration

set -e

echo "🚀 Applying Batch Status Fix Migration..."
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if migration file exists
MIGRATION_FILE="$SCRIPT_DIR/supabase/migrations/093_add_mark_batch_printed_rpc.sql"
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

# Read DB URL from app/.env.local
ENV_FILE="$SCRIPT_DIR/app/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env.local file not found at $ENV_FILE"
    exit 1
fi

# Extract DATABASE_URL (handle potential quotes)
DB_URL=$(grep "^\s*DATABASE_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")

if [ -z "$DB_URL" ]; then
    # Try DATABASE_POOL_URL
    DB_URL=$(grep "^\s*DATABASE_POOL_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "$DB_URL" ]; then
    echo "❌ DATABASE_URL or DATABASE_POOL_URL not found in .env.local"
    exit 1
fi

echo "📝 Applying migration: 093_add_mark_batch_printed_rpc.sql"
echo "🔌 Connecting to database..."

# Apply the migration
psql "$DB_URL" -f "$MIGRATION_FILE"

echo ""
echo "✅ Migration applied successfully!"
