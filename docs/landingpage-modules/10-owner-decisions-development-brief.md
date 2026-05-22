# Landing Page Module — Owner Decisions and Development Brief

## Confirmed Decisions

1. Admin placement:
   Customer & Growth -> Marketing -> Landing Pages

2. Public route:
   /lp/[slug]

3. MVP product source modes:
   - Manual selected products
   - Category source

4. Brand source:
   Can be included only if existing product/brand query support is low-risk.

5. Defer to Phase 2:
   - Campaign source
   - Mixed mode
   - A/B testing
   - Custom domains
   - Full drag/drop builder
   - Complex personalization

6. Public landing page must never fall back to all products.
   If no valid products resolve, show an unavailable/empty campaign state.

7. Reuse existing:
   - Product Catalog
   - ProductCard
   - CartProvider
   - storefront checkout
   - storefront orders
   - payment flow
   - Marketing navigation pattern
   - Storefront layout primitives where practical

8. Do not create a new checkout flow for MVP.
   Extend existing checkout attribution safely.

9. Use a landing page order attribution bridge table for MVP instead of widening storefront_orders immediately, unless implementation proves direct columns are cleaner.

10. Add middleware public allowlist for /lp only.
    Do not accidentally expose admin routes.

11. Product resolver must be server-side.

12. Product resolver must filter:
    - inactive products
    - inactive variants for purchase CTA
    - hidden ecommerce groups
    - deleted/missing references
    - unavailable products based on approved stock rule
    - future compliance/public visibility rules

13. Page-level CTA modes for MVP:
    - view product
    - add to cart
    - buy now
    - WhatsApp inquiry optional

14. If price is hidden or unavailable, direct purchase CTA must be disabled or converted to inquiry/view details.

15. Attribution MVP fields:
    - landing_page_id
    - landing_page_slug
    - landing_page_session_id
    - source_code
    - utm_source
    - utm_medium
    - utm_campaign
    - utm_content
    - utm_term
    - fbclid if retained
    - referrer domain, not full raw referrer URL by default

16. Event tracking MVP:
    - page_view
    - product_impression
    - product_view or product_click
    - add_to_cart
    - buy_now_click
    - checkout_start
    - order_created
    - purchase only from server/payment/order status source

17. Revenue reporting must come from server-side orders/payment status, not client-side events.

18. Admin publish should be blocked when:
    - slug is invalid or duplicated
    - no valid products resolve
    - required hero/title fields are missing
    - CTA mode conflicts with hidden price or unavailable product
    - publish window is invalid

19. MVP should be template-based.
    Do not build drag/drop builder yet.

## Development Scope

Build the MVP Landing Page module.

### Admin Module

Add Landing Pages under:

Customer & Growth -> Marketing -> Landing Pages

Admin features:

1. Landing Pages list.
2. Create landing page.
3. Edit landing page.
4. Duplicate landing page.
5. Preview landing page.
6. Publish/unpublish.
7. Archive if existing admin pattern supports it.
8. Copy public link.
9. Basic metrics columns if data exists.

Required list columns:

- Title
- Slug
- Status
- Product Source
- Selected Products Count
- Category
- Campaign if available
- Views
- Add to Cart
- Orders
- Revenue
- Conversion Rate
- Published At
- Actions

### Create/Edit Form

Build a clean MVP form with sections:

1. Basic Info
   - internal name
   - public title
   - slug
   - description
   - status
   - publish start/end

2. Hero
   - badge text
   - headline/title
   - subtitle/description
   - hero image URL or existing image picker/upload pattern if available
   - primary CTA label
   - secondary CTA label/link optional

3. Product Source
   - source mode: manual or category
   - manual product selector
   - category selector
   - selected product preview
   - sort/order control for manual products
   - max products
   - validation warnings

4. Display / CTA Settings
   - show price
   - show brand
   - show category
   - hide out-of-stock if reliable
   - CTA mode
   - enable add to cart
   - enable buy now
   - enable WhatsApp inquiry optional

5. Tracking
   - source code
   - UTM defaults
   - generated public URL preview

6. Preview & Publish
   - desktop preview
   - mobile preview if practical
   - publish-blocking validation errors

## Public Landing Page

Create public route:

/lp/[slug]

Public page requirements:

1. Anonymous visitors can open published pages only.
2. Draft/unpublished/archived pages are not public.
3. Expired pages show not found or campaign expired state.
4. Page loads curated products only.
5. No product source or zero valid products must show unavailable state.
6. Must not show all products by fallback.
7. Must be mobile-first.
8. Must show:
   - simple header
   - hero
   - trust strip
   - curated product grid/cards
   - CTA buttons
   - footer
9. Reuse storefront components where safe.
10. Preserve landing page attribution into cart/checkout.

Public design direction:

- Minimal
- Professional
- Clean white background
- Serapod2U green/orange accents
- Not crowded
- Product-first
- Facebook Ads friendly
- Mobile responsive

## Product Resolver

Build a server-side curated product resolver.

Required modes for MVP:

1. Manual products.
2. Category source.

Resolver must:

1. Load landing page.
2. Verify status and publish window.
3. Load configured product source rules.
4. Resolve candidate product ids.
5. Deduplicate.
6. Load storefront-safe product data.
7. Filter inactive/hidden/deleted products.
8. Filter inactive variants for purchase CTA.
9. Respect hidden ecommerce group rules.
10. Apply stock behavior if reliable.
11. Apply show/hide price behavior.
12. Apply ordering.
13. Apply max product count.
14. Return empty/unavailable state if nothing valid.

Hard rule:

Never fallback to all storefront products.

## DB / SQL Script Requirements

Any DB scripts or schema planning files must be created under:

/docs/landingpage-modules/db-scripts

Expected files:

1. /docs/landingpage-modules/db-scripts/README.md
2. /docs/landingpage-modules/db-scripts/001-landing-pages-core.sql
3. /docs/landingpage-modules/db-scripts/002-landing-page-source-rules.sql
4. /docs/landingpage-modules/db-scripts/003-landing-page-sessions-events.sql
5. /docs/landingpage-modules/db-scripts/004-landing-page-order-attribution.sql
6. /docs/landingpage-modules/db-scripts/005-landing-page-rls-policies.sql
7. /docs/landingpage-modules/db-scripts/STAGING_RUNBOOK.md

If the repo requires migrations under a standard migration directory, also create the proper migration files there, but keep a copy or reference summary under /docs/landingpage-modules/db-scripts.

Each SQL file must be small, readable, and separated by concern.

Do not mix app code with SQL docs.

STAGING_RUNBOOK.md must include:

- Script order.
- What each script does.
- Any required environment variable.
- Rollback notes where practical.
- How to verify tables/policies after apply.
- Known risks.

## Recommended DB Objects

Use final naming based on repo convention, but expected objects are:

1. landing_pages
2. landing_page_product_rules or landing_page_products/category rules
3. landing_page_sessions
4. landing_page_events
5. landing_page_order_attributions

Prefer a flexible but simple model.

For MVP, manual products and category source are required.

## API Requirements

Follow existing repo API conventions.

Admin APIs likely under existing admin pattern:

- GET landing pages
- POST create landing page
- GET landing page detail
- PUT/PATCH update landing page
- POST publish
- POST unpublish
- POST duplicate
- POST archive
- GET preview/resolve products
- GET metrics

Public/API support:

- Public route /lp/[slug] should server-load data where possible.
- Event ingestion endpoint for client-side events.
- Optional landing page session endpoint if needed.
- Checkout attribution extension for existing /api/storefront/checkout.

Do not create duplicate checkout.

## Checkout Attribution

Extend existing checkout flow safely.

Requirements:

1. Existing checkout must still work without landing page attribution.
2. Landing page attribution must be optional.
3. If attribution is provided, validate server-side.
4. Reject or ignore invalid attribution safely.
5. Store valid attribution in bridge table.
6. Order/revenue reporting must use server-side order/payment data.
7. Do not trust client-side totals or client event revenue.

## Analytics MVP

Admin analytics should show:

Summary:
- views
- sessions
- product clicks
- add to cart
- checkout starts
- orders
- paid orders/revenue if available
- conversion rate

Breakdowns:
- source/UTM
- product performance
- recent orders from landing page

Events:
- page_view
- product_impression
- product_click/product_view
- add_to_cart
- buy_now_click
- checkout_start
- order_created
- purchase if server-side status available

## Security Requirements

1. Admin APIs require authenticated authorized HQ/Marketing access.
2. Public can read only published landing pages.
3. Public event ingestion must validate payload.
4. Public event ingestion must not be unrestricted broad DB write.
5. /lp middleware allowlist must not expose admin paths.
6. Product filtering must happen server-side.
7. Do not expose internal cost/supplier/private product data.
8. Do not expose unpublished content.
9. Slug must be validated and reserved words blocked.
10. Use RLS consistent with repo conventions.

## Testing Requirements

Run relevant tests/checks.

Minimum test cases:

1. Admin can create draft landing page.
2. Admin can select manual products.
3. Admin can select category source.
4. Publish blocked if no valid products.
5. Published page loads at /lp/[slug].
6. Draft page is not public.
7. Empty source does not show all products.
8. Inactive/hidden products do not render.
9. Add to cart still works.
10. Buy now/checkout still works if enabled.
11. Existing /store checkout still works without landing page attribution.
12. Attribution is written for landing page checkout.
13. Non-authorized users cannot manage landing pages.
14. Middleware allows /lp public but does not expose admin routes.

## Staging Deployment Requirement

After implementation:

1. Move/sync the app changes to staging branch/environment according to current repo workflow.
2. Apply required staging DB scripts only if staging process allows it.
3. Do not apply anything to production.
4. Do not merge to main unless owner explicitly requested it.
5. Make sure the staging URL is ready for owner testing.

Create/update:

/docs/landingpage-modules/STAGING_TESTING_GUIDE.md

Include:

- Staging URL/path to test.
- Test login/user required for admin.
- How to create a landing page.
- How to select products/category.
- How to publish.
- How to open public /lp/[slug].
- How to test add to cart / buy now.
- How to confirm attribution.
- Known limitations.
- Any DB scripts applied to staging.