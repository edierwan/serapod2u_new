-- Migration: Create consumer feedback table
-- This allows consumers to submit feedback from the product journey page

-- Create feedback table in public schema
CREATE TABLE IF NOT EXISTS public.consumer_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reference to QR code that was scanned (optional)
    qr_code_id UUID REFERENCES public.qr_codes(id) ON DELETE SET NULL,
    -- Reference to organization (journey owner)
    org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Consumer details
    consumer_name VARCHAR(255),
    consumer_phone VARCHAR(50),
    consumer_email VARCHAR(255),
    -- Feedback content
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    -- Metadata
    product_name VARCHAR(255),
    variant_name VARCHAR(255),
    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'archived')),
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    admin_notes TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_consumer_feedback_org_id ON public.consumer_feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_consumer_feedback_status ON public.consumer_feedback(status);
CREATE INDEX IF NOT EXISTS idx_consumer_feedback_created_at ON public.consumer_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumer_feedback_qr_code_id ON public.consumer_feedback(qr_code_id);

-- Enable RLS
ALTER TABLE public.consumer_feedback ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to insert feedback (public submission)
CREATE POLICY "Anyone can submit feedback"
    ON public.consumer_feedback
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Policy: Allow authenticated users from same org or HQ to view feedback
CREATE POLICY "Users can view their org feedback"
    ON public.consumer_feedback
    FOR SELECT
    TO authenticated
    USING (
        org_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
            UNION
            SELECT id FROM public.organizations WHERE org_type_code = 'HQ'
                AND id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        )
        OR EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            WHERE u.id = auth.uid() AND o.org_type_code = 'HQ'
        )
    );

-- Policy: Allow authenticated users from same org or HQ to update feedback
CREATE POLICY "Users can update their org feedback"
    ON public.consumer_feedback
    FOR UPDATE
    TO authenticated
    USING (
        org_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
            UNION
            SELECT id FROM public.organizations WHERE org_type_code = 'HQ'
                AND id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        )
        OR EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            WHERE u.id = auth.uid() AND o.org_type_code = 'HQ'
        )
    )
    WITH CHECK (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.update_consumer_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_consumer_feedback_updated_at ON public.consumer_feedback;
CREATE TRIGGER trigger_update_consumer_feedback_updated_at
    BEFORE UPDATE ON public.consumer_feedback
    FOR EACH ROW
    EXECUTE FUNCTION public.update_consumer_feedback_updated_at();

-- Grant permissions
GRANT SELECT, INSERT ON public.consumer_feedback TO anon;
GRANT SELECT, INSERT, UPDATE ON public.consumer_feedback TO authenticated;

COMMENT ON TABLE public.consumer_feedback IS 'Consumer feedback submitted from product journey pages';
