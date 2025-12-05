#!/bin/bash

# Script to apply the inventory allocation migration
# This migration adds allocation functions for D2H and S2D orders

echo "🚀 Applying Inventory Allocation Migration..."
echo ""
echo "Migration: 086_add_inventory_allocation_functions.sql"
echo ""

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "   npm install -g supabase"
    exit 1
fi

# Check if we're linked to a project
if [ ! -f ".supabase/config.toml" ]; then
    echo "❌ Not linked to a Supabase project"
    echo "   Run: supabase link --project-ref YOUR_PROJECT_REF"
    exit 1
fi

echo "📋 Migration will create:"
echo "   ✅ allocate_inventory_for_order() function"
echo "   ✅ release_allocation_for_order() function"
echo "   ✅ Updated orders_approve() function"
echo ""

# Apply migration
echo "🔨 Applying migration..."
supabase db push

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Test creating a D2H or S2D order"
    echo "2. Check inventory view - 'Allocated' column should update"
    echo "3. Approve the order - 'Allocated' should decrease, 'On Hand' should decrease"
    echo ""
    echo "Optional: Regenerate TypeScript types"
    echo "   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > app/src/types/database.ts"
else
    echo ""
    echo "❌ Migration failed. Please check the error above."
    exit 1
fi
