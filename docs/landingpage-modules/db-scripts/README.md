# Landing Page Module DB Scripts

Run these scripts in order on staging before owner testing:

1. `001-landing-pages-core.sql`
2. `002-landing-page-source-rules.sql`
3. `003-landing-page-sessions-events.sql`
4. `004-landing-page-order-attribution.sql`
5. `005-landing-page-rls-policies.sql`

The standard Supabase migration copy is available at:

- `supabase/migrations/20260522_landing_pages_mvp.sql`

Important constraints:

- Landing page product resolution is only manual product selection or one category source.
- Empty manual selections stay empty.
- Empty categories stay empty.
- No script creates or enables a fallback to all storefront products.