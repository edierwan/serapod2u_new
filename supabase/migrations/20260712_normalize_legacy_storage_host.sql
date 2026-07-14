-- ============================================================================
-- Normalize legacy Supabase storage hosts in media URLs
-- ----------------------------------------------------------------------------
-- Four Supabase projects have been permanently retired (their servers no longer
-- exist):
--
--     hsvmvmurvpqcdmxckhnz.supabase.co
--     cbqsuzctjotbhxanazhf.supabase.co
--     bamybvzufxijghzqdytu.supabase.co
--     jqihlckqrhdxszgwuymu.supabase.co
--
-- Some media columns still store absolute URLs that point at these dead hosts,
-- which breaks image loading. This migration rewrites ONLY those exact legacy
-- public-object URLs into a host-independent, stable storage path:
--
--     <bucket>/<object-path>[?query]
--
-- i.e. it strips the `https://<legacy-host>/storage/v1/object/public/` prefix.
-- The application's central `getStorageUrl()` resolver reconstructs a full URL
-- from this relative path against whatever storage host the running environment
-- has configured (NEXT_PUBLIC_SUPABASE_URL) and appends the anon apikey. Storing
-- a relative path (rather than a hardcoded new host) keeps the same value valid
-- across staging and production and never re-introduces a dependency on a
-- specific hostname.
--
-- All affected legacy URLs were audited to use buckets `avatars` or
-- `product-images`, both recognised storage buckets, so the relative form
-- resolves correctly. The query string (e.g. `?v=...` cache-buster) is preserved.
--
-- SCOPE / SAFETY:
--   * Additive and idempotent: after conversion a value no longer matches the
--     legacy-host prefix, so re-running is a no-op.
--   * Updates ONLY exact matching legacy-host public-object URLs for the four
--     retired hosts. Current-host URLs, external (non-Supabase) URLs, NULLs, ids,
--     media ownership, primary/default flags and timestamps are left untouched.
--   * No destructive deletes. No historical return snapshots are touched (they
--     store denormalized product/variant names/SKUs, not media URLs).
--
-- Estimated rows (audited 2026-07-12 on staging). All matches were on
-- `hsvmvmurvpqcdmxckhnz`; the other three retired hosts had 0 rows but are
-- covered by the same alternation for completeness:
--   variant_media.url ................. 65
--   variant_media.thumbnail_url ....... 0
--   product_variants.image_url ........ 62
--   product_variants.animation_url .... 2
--   product_images.image_url .......... 9
--   organizations.logo_url ............ 12
--   brands.logo_url ................... 5
--   product_categories.image_url ...... 4
--   redeem_items.animation_url ........ 5
--   redeem_items.additional_images .... 21   (jsonb array of URLs)
--   product_variants.additional_images  0    (jsonb; guarded, covered for safety)
--   TOTAL ............................. ~185
--
-- BEFORE:
--   https://cbqsuzctjotbhxanazhf.supabase.co/storage/v1/object/public/avatars/example.jpg
-- AFTER:
--   avatars/example.jpg
--
-- BEFORE:
--   https://hsvmvmurvpqcdmxckhnz.supabase.co/storage/v1/object/public/avatars/variant-1766464396313.jpg?v=1766464396823
-- AFTER:
--   avatars/variant-1766464396313.jpg?v=1766464396823
-- ============================================================================

BEGIN;

-- Scalar text columns: strip the legacy-host public-object prefix (any of the
-- four retired hosts, http or https), anchored at the start of the value.
-- regexp: ^https?://(host1|host2|host3|host4)\.supabase\.co/storage/v1/object/public/

UPDATE public.variant_media
   SET url = regexp_replace(url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.variant_media
   SET thumbnail_url = regexp_replace(thumbnail_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE thumbnail_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.product_variants
   SET image_url = regexp_replace(image_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE image_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.product_variants
   SET animation_url = regexp_replace(animation_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE animation_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.product_images
   SET image_url = regexp_replace(image_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE image_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.organizations
   SET logo_url = regexp_replace(logo_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE logo_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.brands
   SET logo_url = regexp_replace(logo_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE logo_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.product_categories
   SET image_url = regexp_replace(image_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE image_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.redeem_items
   SET animation_url = regexp_replace(animation_url, '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/', '')
 WHERE animation_url ~ '^https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

-- jsonb arrays of URLs: rewrite every embedded legacy public-object URL to its
-- relative path. The global regexp_replace operates on the jsonb text form and
-- the result is re-parsed as jsonb, so array structure/ordering is preserved.
UPDATE public.redeem_items
   SET additional_images = regexp_replace(
         additional_images::text,
         'https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/',
         '', 'g'
       )::jsonb
 WHERE additional_images::text ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

UPDATE public.product_variants
   SET additional_images = regexp_replace(
         additional_images::text,
         'https?://(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/',
         '', 'g'
       )::jsonb
 WHERE additional_images::text ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co/storage/v1/object/public/';

COMMIT;

-- ============================================================================
-- VERIFICATION (run AFTER applying — legacy_url_count must be 0 for all rows):
--
--   SELECT 'variant_media.url'                 AS col, count(*) AS legacy_url_count FROM public.variant_media       WHERE url            ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'variant_media.thumbnail_url',       count(*) FROM public.variant_media       WHERE thumbnail_url  ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'product_variants.image_url',        count(*) FROM public.product_variants    WHERE image_url      ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'product_variants.animation_url',    count(*) FROM public.product_variants    WHERE animation_url  ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'product_variants.additional_images',count(*) FROM public.product_variants    WHERE additional_images::text ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'product_images.image_url',          count(*) FROM public.product_images      WHERE image_url      ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'organizations.logo_url',            count(*) FROM public.organizations       WHERE logo_url       ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'brands.logo_url',                   count(*) FROM public.brands              WHERE logo_url       ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'product_categories.image_url',      count(*) FROM public.product_categories  WHERE image_url      ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'redeem_items.animation_url',        count(*) FROM public.redeem_items        WHERE animation_url  ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co'
--   UNION ALL SELECT 'redeem_items.additional_images',    count(*) FROM public.redeem_items        WHERE additional_images::text ~ '(hsvmvmurvpqcdmxckhnz|cbqsuzctjotbhxanazhf|bamybvzufxijghzqdytu|jqihlckqrhdxszgwuymu)\.supabase\.co';
-- ============================================================================
