# Inventory Opening Balance Cut-off deployment

Do not run these files on behalf of an operator. Apply them manually, in this exact order:

1. `supabase/migrations/20260726_inventory_opening_balance_cutoff/01_cutoff_foundation.sql`
2. `supabase/migrations/20260726_inventory_opening_balance_cutoff/02_cutoff_preview_and_decisions.sql`
3. `supabase/migrations/20260726_inventory_opening_balance_cutoff/03_cutoff_atomic_posting.sql`

The first file adds cut-off metadata, RLS, audit storage, the Stock Count type, and warehouse freeze gates. The second adds the read-only preview and validated decision RPC. The third adds OTP-protected atomic posting and makes H2M receipt posting follow the order item's selected stock configuration.

After applying all three files, deploy the application build. No backfill is required. Existing inventory, orders, movements, receipts, and QR/traceability data remain historical records.

Rollback must be planned as a forward migration. Do not drop cut-off audit/report rows after a cut-off has been posted.
