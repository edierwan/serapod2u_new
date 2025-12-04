# Quality & Return Issues — DB + UI Implementation

This documents the new manufacturer quality/return issues workflow added in the
project.

What was added

- DB migrations
  - `supabase/migrations/073_add_manufacturer_ack_to_stock_adjustments.sql`
    - Adds columns to `stock_adjustments` for manufacturer assignment and
      acknowledgement.
    - Seeds `stock_adjustment_reasons` with `quality_issue` and
      `return_to_supplier` reasons.
  - `supabase/migrations/074_create_manufacturer_actions_and_functions.sql`
    - Adds `stock_adjustment_manufacturer_actions` audit table and RLS policies.
    - Adds RPC functions: `assign_adjustment_to_manufacturer`,
      `manufacturer_acknowledge_adjustment`, `admin_update_adjustment_status`.

- Backend API endpoints (Next.js server routes)
  - Manufacturer: `GET /api/manufacturer/adjustments`
  - Manufacturer: `GET /api/manufacturer/adjustments/[id]`
  - Manufacturer: `POST /api/manufacturer/adjustments/[id]` (acknowledge)
  - Admin (super-admin only): `POST /api/admin/adjustments/[id]/assign` (assign
    to manufacturer)
  - Admin (super-admin only): `POST /api/admin/adjustments/[id]/status` (set
    resolved/rejected)

- Frontend
  - New page (visible to manufacturer users and super admins):
    `/manufacturer/quality-issues`
  - Client component at `src/components/manufacturer/QualityIssuesView.tsx` —
    lists adjustments, shows details, attachments, and has acknowledge and admin
    actions.

  Important UI change

  - Evidence is now mandatory for adjustments with reason codes `quality_issue`
    and `return_to_supplier`.
    - The stock adjustment UI (`StockAdjustmentView`) enforces that the user
      attaches at least one image before adding to the pending queue when those
      reasons are selected.
    - The batch "Process All Adjustments" button will be disabled when any
      pending item requires evidence but has no attachment; the user is prompted
      to attach images first.

How it works

1. When stock adjustments are created with reason `quality_issue` or
   `return_to_supplier` they can be assigned to a manufacturer (either
   automatically in your process or by a super admin using the assign endpoint /
   UI).
2. Assigned adjustments will appear on the manufacturer page
   (`/manufacturer/quality-issues`) for users in the manufacturer org.
3. Manufacturer users can view details and attachments, then click
   "Acknowledge". This calls the DB RPC `manufacturer_acknowledge_adjustment`,
   sets acknowledgement fields and inserts an audit row in
   `stock_adjustment_manufacturer_actions`.
4. Super admins can view all issues and set final status (`resolved` or
   `rejected`).

How to run the migration

1. Use your normal migration system or run the SQL files directly against
   Supabase/Postgres:

```bash
psql "$DATABASE_URL" -f ./supabase/migrations/073_add_manufacturer_ack_to_stock_adjustments.sql
psql "$DATABASE_URL" -f ./supabase/migrations/074_create_manufacturer_actions_and_functions.sql
```

2. Verify the new columns, functions and seeded reasons (see queries below).

Verification queries

```sql
-- Verify columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_adjustments' AND column_name LIKE 'manufacturer%';

-- Verify seeded reasons
SELECT reason_code, reason_name, requires_approval FROM stock_adjustment_reasons WHERE reason_code IN ('quality_issue','return_to_supplier');

-- Verify the RPC functions
SELECT proname FROM pg_proc WHERE proname LIKE '%adjustment%';
```

Testing endpoints locally

Assuming your app is running on http://localhost:3000 and you are authenticated:

- List adjustments (manufacturer view):

```bash
curl -i -X GET 'http://localhost:3000/api/manufacturer/adjustments' \ 
  -H "Authorization: Bearer <user_token>"
```

- Acknowledge an adjustment (manufacturer):

```bash
curl -i -X POST 'http://localhost:3000/api/manufacturer/adjustments/<adjustment_id>' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <user_token>" \
  -d '{"notes":"Received and acknowledged — awaiting action"}'
```

- Assign an adjustment to manufacturer (super admin):

```bash
curl -i -X POST http://localhost:3000/api/admin/adjustments/<id>/assign \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <super_admin_token>" \
  -d '{"manufacturer_org_id":"<org_id>"}'
```

- Mark final status (super admin):

```bash
curl -i -X POST http://localhost:3000/api/admin/adjustments/<id>/status \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <super_admin_token>" \
  -d '{"status":"resolved","notes":"Closed by support team" }'
```

Further improvements

- Automatically assign manufacturer when Process All Adjustments is called (the
  front-end Stock Adjustment flow can call `assign_adjustment_to_manufacturer`
  for each 'quality_issue'/'return_to_supplier' item using the
  product.manufacturer_id).
- Add a server-side background job to notify the manufacturer when a new issue
  is assigned (via email / webhook).
- Add UI tests and end-to-end tests covering the new flows.

If you want, I can now:

- Implement automatic assignment from the Process All Adjustments flow so items
  are assigned to manufacturer automatically when those reasons are selected.
- Add end-to-end tests for the UI and API.
