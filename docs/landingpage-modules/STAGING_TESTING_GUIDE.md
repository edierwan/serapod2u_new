# Landing Pages MVP - Staging Testing Guide

## Environment

- Staging app: https://stg.serapod2u.com
- Admin route: https://stg.serapod2u.com/marketing
- Public route pattern: `https://stg.serapod2u.com/lp/<slug>`
- Admin location: Customer & Growth -> Marketing -> Landing Pages
- Required tester: HQ admin or HQ manager account with role level 30 or lower.

## Staging Apply Status

- Database migration: applied to `serapod-stg-db` on 2026-05-22.
- Verified tables: `landing_pages`, `landing_page_products`, `landing_page_sessions`, `landing_page_events`, `landing_page_order_attributions`.
- Verified RLS policies: 7 landing-page policies present.
- Production: untouched.

## Owner Test Flow

1. Sign in to staging with an HQ admin account.
2. Open Customer & Growth -> Marketing -> Landing Pages.
3. Click New Page.
4. Fill Internal Name, Public Title, Slug, Description, Hero Headline, and Hero Subtitle.
5. Choose Manual source and select two to four active storefront products, or choose Category and select one category.
6. Save Draft.
7. Open Preview and confirm the page renders only the selected manual products or category products.
8. Click Publish.
9. Open the Public Page link at `/lp/<slug>`.
10. Confirm add-to-cart and buy-now buttons use the existing store cart and existing checkout.
11. Complete checkout far enough to create an order or payment redirect.
12. Return to Landing Pages and confirm page metrics update after events/orders are recorded.

## No-Fallback Checks

- Manual source with zero products must publish-fail or render unavailable; it must not show all storefront products.
- Category source with an empty category must publish-fail or render unavailable; it must not show all storefront products.
- Archived or draft pages must not be public at `/lp/<slug>`.

## Checkout Attribution Checks

- Visit a public landing page with UTM values, for example `/lp/<slug>?utm_source=owner-test&utm_campaign=landing-mvp`.
- Add a product to cart from the landing page.
- Continue through the existing storefront checkout.
- Confirm a row is created in `landing_page_order_attributions` for the order.
- Confirm the existing checkout still works when no landing-page attribution is present.

## Known Limitations For MVP

- There is no drag-and-drop product ordering UI yet; manual order follows selection/insertion order.
- Analytics are simple aggregate counts from events and order attribution.
- Public page styling is one campaign template, not a template builder.
- Product images depend on existing product variant media configuration.
- Full app TypeScript still reports pre-existing unrelated errors outside this module; landing-page files have clean VS Code diagnostics.