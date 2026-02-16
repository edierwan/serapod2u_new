-- Migration: Store Hero Banners
-- Stores hero banner slides for the storefront (/store) page.
-- Each org can have multiple banners displayed in a rotating slider.

CREATE TABLE IF NOT EXISTS public.store_hero_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Display content
    title text NOT NULL DEFAULT '',
    subtitle text DEFAULT '',
    badge_text text DEFAULT '',                          -- e.g. "New Collection", "Sale"
    image_url text NOT NULL,                             -- Supabase storage public URL
    link_url text DEFAULT '/store/products',             -- CTA destination
    link_text text DEFAULT 'Shop Now',                   -- CTA button label

    -- Presentation
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone DEFAULT now(),
    ends_at timestamp with time zone,                    -- NULL = no expiry

    -- Audit
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid REFERENCES public.users(id),
    updated_by uuid REFERENCES public.users(id)
);

-- Comments
COMMENT ON TABLE  public.store_hero_banners IS 'Hero banner slides for the storefront home page slider';
COMMENT ON COLUMN public.store_hero_banners.image_url IS 'Public URL to banner image in Supabase storage (store-banners bucket)';
COMMENT ON COLUMN public.store_hero_banners.sort_order IS 'Display order in slider — lower values first';
COMMENT ON COLUMN public.store_hero_banners.starts_at IS 'Banner becomes visible after this timestamp';
COMMENT ON COLUMN public.store_hero_banners.ends_at IS 'Banner stops being visible after this timestamp (NULL = always visible)';

-- Indexes
CREATE INDEX idx_store_hero_banners_org_id ON public.store_hero_banners(org_id);
CREATE INDEX idx_store_hero_banners_active ON public.store_hero_banners(org_id, is_active, sort_order)
    WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.store_hero_banners ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ────────────────────────────────────────────────────

-- Public read: anyone can read active banners (storefront is public)
CREATE POLICY "Anyone can view active store banners"
    ON public.store_hero_banners
    FOR SELECT
    USING (
        is_active = true
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at > now())
    );

-- Org users can view all banners (including inactive) for their org
CREATE POLICY "Org users can view all their org banners"
    ON public.store_hero_banners
    FOR SELECT
    USING (
        org_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
        )
    );

-- HQ admins (role_level <= 30) can manage banners
CREATE POLICY "HQ admins can insert store banners"
    ON public.store_hero_banners
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            JOIN public.roles r ON u.role_code = r.role_code
            WHERE u.id = auth.uid()
            AND o.org_type_code = 'HQ'
            AND r.role_level <= 30
            AND u.organization_id = org_id
        )
    );

CREATE POLICY "HQ admins can update store banners"
    ON public.store_hero_banners
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            JOIN public.roles r ON u.role_code = r.role_code
            WHERE u.id = auth.uid()
            AND o.org_type_code = 'HQ'
            AND r.role_level <= 30
            AND u.organization_id = org_id
        )
    );

CREATE POLICY "HQ admins can delete store banners"
    ON public.store_hero_banners
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            JOIN public.roles r ON u.role_code = r.role_code
            WHERE u.id = auth.uid()
            AND o.org_type_code = 'HQ'
            AND r.role_level <= 30
            AND u.organization_id = org_id
        )
    );

-- updated_at trigger
CREATE TRIGGER update_store_hero_banners_updated_at
    BEFORE UPDATE ON public.store_hero_banners
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ── Storage bucket ──────────────────────────────────────────────────
-- Create store-banners bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'store-banners',
    'store-banners',
    true,
    5242880,  -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: anyone can read
CREATE POLICY "Public read store banners" ON storage.objects
    FOR SELECT USING (bucket_id = 'store-banners');

-- Storage policy: authenticated users can upload
CREATE POLICY "Auth users can upload store banners" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'store-banners'
        AND auth.role() = 'authenticated'
    );

-- Storage policy: authenticated users can update their uploads
CREATE POLICY "Auth users can update store banners" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'store-banners'
        AND auth.role() = 'authenticated'
    );

-- Storage policy: authenticated users can delete
CREATE POLICY "Auth users can delete store banners" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'store-banners'
        AND auth.role() = 'authenticated'
    );
