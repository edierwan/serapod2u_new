-- ============================================================================
-- Migration: Variant Media (Polymorphic)
-- Date: 2026-02-18
-- Description: Unified variant media table replacing separate image_url and
--              animation_url columns. Supports images + videos per variant.
-- ============================================================================

-- 1. Create variant_media table
CREATE TABLE IF NOT EXISTS public.variant_media (
    id              uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    type            text NOT NULL CHECK (type IN ('image', 'video')),
    url             text NOT NULL,
    thumbnail_url   text,           -- for video: auto-generated poster frame
    sort_order      integer DEFAULT 0,
    is_default      boolean DEFAULT false,
    file_size       integer,        -- bytes
    mime_type       text,
    width           integer,
    height          integer,
    duration_ms     integer,        -- video duration in milliseconds
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_variant_media_variant_id ON public.variant_media(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_media_sort ON public.variant_media(variant_id, sort_order);

-- 3. RLS policies
ALTER TABLE public.variant_media ENABLE ROW LEVEL SECURITY;

-- Public read access (storefront)
CREATE POLICY "variant_media_public_read"
    ON public.variant_media
    FOR SELECT
    USING (true);

-- Authenticated users can manage
CREATE POLICY "variant_media_auth_insert"
    ON public.variant_media
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "variant_media_auth_update"
    ON public.variant_media
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "variant_media_auth_delete"
    ON public.variant_media
    FOR DELETE
    TO authenticated
    USING (true);

-- 4. Backfill existing data: migrate image_url and animation_url into variant_media
INSERT INTO public.variant_media (variant_id, type, url, sort_order, is_default, mime_type)
SELECT
    id AS variant_id,
    'image' AS type,
    image_url AS url,
    0 AS sort_order,
    true AS is_default,
    'image/jpeg' AS mime_type
FROM public.product_variants
WHERE image_url IS NOT NULL
  AND image_url <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.variant_media (variant_id, type, url, sort_order, is_default, mime_type)
SELECT
    id AS variant_id,
    'video' AS type,
    animation_url AS url,
    CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN 1 ELSE 0 END AS sort_order,
    CASE WHEN image_url IS NULL OR image_url = '' THEN true ELSE false END AS is_default,
    'video/mp4' AS mime_type
FROM public.product_variants
WHERE animation_url IS NOT NULL
  AND animation_url <> ''
ON CONFLICT DO NOTHING;

-- 5. Trigger to sync image_url on product_variants with default media item
CREATE OR REPLACE FUNCTION public.sync_variant_default_media()
RETURNS trigger AS $$
BEGIN
    -- When a media item is set as default, update the variant's image_url
    IF NEW.is_default = true THEN
        -- Unset other defaults for this variant
        UPDATE public.variant_media
        SET is_default = false, updated_at = now()
        WHERE variant_id = NEW.variant_id
          AND id <> NEW.id
          AND is_default = true;

        -- Sync to product_variants.image_url for backward compat
        IF NEW.type = 'image' THEN
            UPDATE public.product_variants
            SET image_url = NEW.url, updated_at = now()
            WHERE id = NEW.variant_id;
        ELSIF NEW.type = 'video' AND NEW.thumbnail_url IS NOT NULL THEN
            UPDATE public.product_variants
            SET image_url = NEW.thumbnail_url, updated_at = now()
            WHERE id = NEW.variant_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_variant_default_media
    AFTER INSERT OR UPDATE OF is_default
    ON public.variant_media
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_variant_default_media();

-- Done
