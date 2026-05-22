# Staging DB Runbook

Target: staging Supabase project only.

## Apply

From the repository root, apply the standard migration through the project deployment flow, or run the docs scripts in order:

```bash
psql "$STAGING_DATABASE_URL" -f docs/landingpage-modules/db-scripts/001-landing-pages-core.sql
psql "$STAGING_DATABASE_URL" -f docs/landingpage-modules/db-scripts/002-landing-page-source-rules.sql
psql "$STAGING_DATABASE_URL" -f docs/landingpage-modules/db-scripts/003-landing-page-sessions-events.sql
psql "$STAGING_DATABASE_URL" -f docs/landingpage-modules/db-scripts/004-landing-page-order-attribution.sql
psql "$STAGING_DATABASE_URL" -f docs/landingpage-modules/db-scripts/005-landing-page-rls-policies.sql
```

## Smoke Checks

```sql
select to_regclass('public.landing_pages') as landing_pages;
select to_regclass('public.landing_page_products') as landing_page_products;
select to_regclass('public.landing_page_sessions') as landing_page_sessions;
select to_regclass('public.landing_page_events') as landing_page_events;
select to_regclass('public.landing_page_order_attributions') as landing_page_order_attributions;
```

## Rollback Notes

Use normal database backups for rollback. The tables are isolated from existing checkout tables except for the optional attribution bridge to `storefront_orders`.