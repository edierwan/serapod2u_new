# RoadTour Event Product Category Experience

## Scope

Product category belongs to a RoadTour Event (`roadtour_runs`), not to a RoadTour Campaign. It selects the participant-facing mobile experience while leaving QR generation, friendly links, claims, registration, surveys, rewards, and duplicate protection unchanged.

## Existing QR flow and integration point

1. QR management reads or creates `roadtour_qr_codes` and uses its existing `canonical_path`; legacy links continue to use `/scan?rt={token}`.
2. A friendly URL resolves the QR short code in `resolveRoadTourByFriendlyPath`. The legacy scan URL validates the same token directly.
3. `validate_roadtour_qr_token` resolves the existing QR/campaign/claim context.
4. The page builds the existing RoadTour context and renders `RoadtourJourneyWrapper`.
5. `RoadtourJourneyWrapper` renders the existing `PremiumLoyaltyTemplate` RoadTour path.

Category resolution is inserted between steps 3 and 4. The existing QR row joins its existing campaign and event relation to read `roadtour_runs.product_category_id`. The central experience resolver chooses the mobile experience, and the wrapper renders it. No QR token, path, campaign assignment, or claim payload was changed.

## Experience registry

`app/src/lib/roadtour/experience-registry.ts` is the single registry and resolver.

| Product category | Experience | Status |
| --- | --- | --- |
| Vape | Existing `PremiumLoyaltyTemplate` RoadTour UI | Active |
| Electronic | Reserved | Coming soon |
| Outdoor | Reserved | Coming soon |
| Pet Food | Reserved | Coming soon |

A category is selectable only when its Product Master Data row is active and its mapped RoadTour experience is active. The API independently applies the same validation and rejects inactive, unavailable, unknown, or missing category submissions.

## Safe fallback

The resolver returns Vape when the event category is null, deleted, inactive, unmapped, or mapped to an inactive experience. Therefore existing events and QR links retain the current mobile UI. Vape is also selected by default for newly created events when its active master-data row loads.

During a rolling deployment, Event and QR reads retry with the legacy column selection when PostgREST reports that `product_category_id` or its relationship is not available yet. Legacy rows are returned with an in-memory null category. This keeps original Event IDs and campaign foreign keys visible while the additive migration is pending; it does not update any database row.

## Schema

Migration `20260621_roadtour_event_product_category_experience.sql` adds nullable `roadtour_runs.product_category_id`, an index, and a foreign key to `product_categories(id)` with `ON DELETE SET NULL`. Nullable staging is intentional: null means Vape fallback and no existing rows need backfilling.

## Deployment

Apply the migration before deploying the application because mobile QR resolution reads the new relation. Test locally first. Do not apply to staging until the existing Transport Request receives explicit approval. Production/main are out of scope.
