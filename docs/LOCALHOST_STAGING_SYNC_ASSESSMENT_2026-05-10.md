# Localhost To Staging Sync Assessment

Date: 2026-05-10

## Scope Of This Sync

This sync is for the QR consumer profile flow and notification settings only.

Included task scope:

- QR create-new-shop flow now requires a valid normalized contact phone before creation.
- QR create-new-shop flow now returns to the shop picker with the new shop selected and keeps the normal Save Changes step for point collection.
- New notification event added: `user_created_shop` under the `user` notification category.
- Shop creation now queues an admin-configurable notification event.

## Files Intended For This Sync

- `app/src/components/shop-requests/CreateShopDialog.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/app/api/shops/create/route.ts`
- `app/src/app/api/cron/notification-outbox-worker/route.ts`
- `app/src/config/notificationTemplates.ts`
- `supabase/migrations/20260510_add_user_created_shop_notification_type.sql`
- `docs/LOCALHOST_STAGING_SYNC_ASSESSMENT_2026-05-10.md`

## Localhost Dirty Work Found

These changes were already present in the localhost worktree and are outside this QR shop-create scope.

Tracked modified files:

- `.gitignore`
- `app/src/app/api/support/whatsapp/ingest/route.ts`
- `app/src/app/api/wa/marketing/campaigns/[id]/launch/route.ts`
- `app/src/app/api/wa/marketing/campaigns/[id]/run-now/route.ts`
- `app/src/app/api/wa/marketing/test-send/route.ts`
- `app/src/app/loyalty/marketing/_components/CampaignsList.tsx`
- `app/src/components/dashboard/views/reporting/DistributorReportsTab.tsx`
- `app/src/components/dashboard/views/reporting/ExecutiveKpiValue.tsx`
- `app/src/components/dashboard/views/reporting/ProductsTab.tsx`
- `app/src/components/dashboard/views/reporting/ShopPerformanceTab.tsx`
- `baileys-gateway/ecosystem.config.cjs`
- `baileys-gateway/src/services/webhook.service.ts`

Untracked local artifacts and working files:

- `.tmp/`
- `app/.tmp/`
- `app/scripts/reporting/`
- `docs/Untitled-1.ipynb`
- `docs/getouch.my.code-workspace`
- `docs/reporting-data-coverage-audit/`
- `docs/serapod2u_main.code-workspace`
- `supabase/migrations/serapod2u_main.code-workspace`

## Assessment

Observed dirty-work categories:

- Reporting audit work is in progress locally and includes tracked reporting view edits plus new audit scripts and docs.
- WhatsApp ingest and marketing launch/test changes are in progress locally and unrelated to the QR shop-create flow.
- Gateway config changes are in progress locally and should not be bundled into this staging push unless explicitly requested.
- Local `.tmp` scripts contain staging/prod operational helpers and should stay out of normal sync pushes.
- Workspace files and notebooks are local tooling artifacts and should not be treated as deployable application changes.

## Sync Recommendation

For localhost-to-staging sync, only push the scoped QR and notification files listed in "Files Intended For This Sync".

Do not include the unrelated reporting, WhatsApp, gateway, `.tmp`, notebook, or workspace-file changes unless they are reviewed and requested as a separate sync batch.

## Validation Notes

- Touched files are clean in editor diagnostics.
- Repo-wide TypeScript remains noisy from many unrelated pre-existing errors.
- `PremiumLoyaltyTemplate.tsx` still has pre-existing local type noise around the pending-collect parser and stale RPC typings; those were not introduced by this sync.