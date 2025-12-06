#!/bin/bash

# Apply the optimized mark_batch_printed RPC migration
# This fixes timeout errors when marking large batches as printed

echo "🚀 Applying optimized mark_batch_printed RPC migration..."

cd "$(dirname "$0")"

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "   npm install -g supabase"
    exit 1
fi

# Apply the migration
echo "📝 Running migration 102_optimize_mark_batch_printed_rpc.sql..."
supabase db push --include-all

if [ $? -eq 0 ]; then
    echo "✅ Migration applied successfully!"
    echo ""
    echo "The mark_batch_as_printed function now:"
    echo "  - Processes QR codes in chunks of 1000 to prevent timeouts"
    echo "  - Has a 120-second statement timeout"
    echo "  - Returns detailed results including counts"
    echo "  - Handles errors gracefully"
else
    echo "❌ Migration failed. Please check the error above."
    exit 1
fi
