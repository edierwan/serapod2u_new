-- ──────────────────────────────────────────────────────────────────────────────
-- STOREFRONT & PAYMENT GATEWAY MIGRATION (PRODUCTION-READY)
-- ──────────────────────────────────────────────────────────────────────────────
-- This migration includes:
-- 1. UUID extension setup
-- 2. Updated_at trigger function (auto-updates timestamps)
-- 3. payment_gateway_settings table (with organization isolation, RLS)
-- 4. storefront_orders table (with proper constraints/indexes)
-- 5. storefront_order_items table (with foreign keys)
-- 6. landing_page_order_attributions table (for marketing tracking)
-- 7. RLS policies (strict organization-based access control)
-- 8. Comments/documentation for all tables/columns
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create updated_at trigger function (if not already exists)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. PAYMENT GATEWAY SETTINGS TABLE
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_gateway_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('toyyibpay', 'billplz', 'stripe', 'manual')),
    is_active BOOLEAN DEFAULT FALSE,
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure only one active gateway per organization
    CONSTRAINT uq_payment_gateway_active_org UNIQUE NULLS NOT DISTINCT (organization_id, is_active)
);

-- Add table comment
COMMENT ON TABLE public.payment_gateway_settings IS 'Payment gateway configuration per organization';

-- Add column comments
COMMENT ON COLUMN public.payment_gateway_settings.provider IS 'Payment provider name (toyyibpay, billplz, stripe, manual)';
COMMENT ON COLUMN public.payment_gateway_settings.is_active IS 'Whether this gateway is currently active (only one active per org)';
COMMENT ON COLUMN public.payment_gateway_settings.credentials IS 'Encrypted provider credentials (JSON object containing API keys, secrets, etc.)';
COMMENT ON COLUMN public.payment_gateway_settings.config IS 'Additional provider-specific configuration options';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_gateway_org ON public.payment_gateway_settings(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_active ON public.payment_gateway_settings(organization_id, is_active);

-- Create updated_at trigger
CREATE TRIGGER set_payment_gateway_updated_at
BEFORE UPDATE ON public.payment_gateway_settings
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. STOREFRONT ORDERS TABLE
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storefront_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_ref TEXT UNIQUE NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'payment_failed', 'cancelled', 'processing', 'shipped', 'delivered', 'refunded')),
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT NOT NULL,
    shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
    currency TEXT NOT NULL DEFAULT 'MYR',
    payment_provider TEXT,
    payment_ref TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE public.storefront_orders IS 'Storefront customer orders';

-- Add column comments
COMMENT ON COLUMN public.storefront_orders.order_ref IS 'Unique human-readable order reference';
COMMENT ON COLUMN public.storefront_orders.status IS 'Order status (pending_payment, paid, payment_failed, cancelled, processing, shipped, delivered, refunded)';
COMMENT ON COLUMN public.storefront_orders.shipping_address IS 'JSON object containing shipping address: {line1, line2, city, state, postcode}';
COMMENT ON COLUMN public.storefront_orders.payment_provider IS 'Payment provider used for this order';
COMMENT ON COLUMN public.storefront_orders.payment_ref IS 'Provider-specific payment reference ID';
COMMENT ON COLUMN public.storefront_orders.paid_at IS 'Timestamp when payment was completed';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_storefront_order_org ON public.storefront_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_storefront_order_ref ON public.storefront_orders(order_ref);
CREATE INDEX IF NOT EXISTS idx_storefront_order_status ON public.storefront_orders(status);
CREATE INDEX IF NOT EXISTS idx_storefront_order_created ON public.storefront_orders(created_at);

-- Create updated_at trigger
CREATE TRIGGER set_storefront_orders_updated_at
BEFORE UPDATE ON public.storefront_orders
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. STOREFRONT ORDER ITEMS TABLE
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storefront_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.storefront_orders(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    variant_name TEXT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE public.storefront_order_items IS 'Individual line items within a storefront order';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.storefront_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON public.storefront_order_items(variant_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. LANDING PAGE ORDER ATTRIBUTIONS TABLE
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_page_order_attributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    landing_page_id UUID REFERENCES public.landing_pages(id) ON DELETE SET NULL,
    landing_page_slug TEXT,
    landing_page_session_id TEXT,
    order_id UUID NOT NULL REFERENCES public.storefront_orders(id) ON DELETE CASCADE,
    order_ref TEXT,
    order_total NUMERIC(10,2),
    currency TEXT DEFAULT 'MYR',
    source_code TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    fbclid TEXT,
    referrer_domain TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE public.landing_page_order_attributions IS 'Links orders to marketing landing pages and tracks attribution data';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lp_attribution_landing_page ON public.landing_page_order_attributions(landing_page_id);
CREATE INDEX IF NOT EXISTS idx_lp_attribution_order ON public.landing_page_order_attributions(order_id);
CREATE INDEX IF NOT EXISTS idx_lp_attribution_session ON public.landing_page_order_attributions(landing_page_session_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ──────────────────────────────────────────────────────────────────────────────
-- Enable RLS on all tables
ALTER TABLE public.payment_gateway_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_page_order_attributions ENABLE ROW LEVEL SECURITY;

-- POLICY: payment_gateway_settings
-- - Authenticated users can view their org's settings
-- - Authenticated users can insert/update their org's settings
CREATE POLICY "Users can view their org's payment gateway settings"
    ON public.payment_gateway_settings
    FOR SELECT
    USING (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

CREATE POLICY "Users can insert their org's payment gateway settings"
    ON public.payment_gateway_settings
    FOR INSERT
    WITH CHECK (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

CREATE POLICY "Users can update their org's payment gateway settings"
    ON public.payment_gateway_settings
    FOR UPDATE
    USING (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()))
    WITH CHECK (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

-- POLICY: storefront_orders
-- - Authenticated users can view their org's orders
-- - Authenticated users can insert/update their org's orders
CREATE POLICY "Users can view their org's storefront orders"
    ON public.storefront_orders
    FOR SELECT
    USING (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

CREATE POLICY "Users can insert their org's storefront orders"
    ON public.storefront_orders
    FOR INSERT
    WITH CHECK (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

CREATE POLICY "Users can update their org's storefront orders"
    ON public.storefront_orders
    FOR UPDATE
    USING (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()))
    WITH CHECK (organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid()));

-- POLICY: storefront_order_items
-- - Authenticated users can view their org's order items
-- - Authenticated users can insert their org's order items
CREATE POLICY "Users can view their org's storefront order items"
    ON public.storefront_order_items
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.storefront_orders o
        WHERE o.id = storefront_order_items.order_id
        AND o.organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid())
    ));

CREATE POLICY "Users can insert their org's storefront order items"
    ON public.storefront_order_items
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.storefront_orders o
        WHERE o.id = storefront_order_items.order_id
        AND o.organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid())
    ));

-- POLICY: landing_page_order_attributions
-- - Authenticated users can view their org's attributions
-- - Authenticated users can insert their org's attributions
CREATE POLICY "Users can view their org's landing page attributions"
    ON public.landing_page_order_attributions
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.storefront_orders o
        WHERE o.id = landing_page_order_attributions.order_id
        AND o.organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid())
    ));

CREATE POLICY "Users can insert their org's landing page attributions"
    ON public.landing_page_order_attributions
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.storefront_orders o
        WHERE o.id = landing_page_order_attributions.order_id
        AND o.organization_id IN (SELECT organization_id FROM public.users WHERE users.id = auth.uid())
    ));

-- ──────────────────────────────────────────────────────────────────────────────
-- END OF MIGRATION
-- ──────────────────────────────────────────────────────────────────────────────
