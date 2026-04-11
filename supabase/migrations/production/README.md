# Pending Production SQL

This folder is a staging-prep checklist for SQL scripts that should be reviewed and run on production later.

Keep the original migration files in the main `supabase/migrations/` folder so local tooling and history stay intact.

Current production-later queue:

- `20260411_add_user_call_name.sql`
- `20260411_point_claim_mode_single_or_dual.sql`
- `20260412_dual_claim_and_taxonomy_phase1.sql`
- `20260412_dual_claim_and_taxonomy_phase2.sql`

Staging-only scripts that should not be moved into the production queue:

- `20260411_staging_legacy_shop_lane_cleanup.sql`
- `20260411_staging_restore_shop_staff_attribution_template.sql`
