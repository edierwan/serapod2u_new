-- =====================================================
-- FIX 1: Add missing SI sequence for production
-- =====================================================
-- The SI documents exist (SI26000001, SI26000002, SI26000003-01, etc.)
-- but the SI sequence is NOT in doc_sequences table!
-- This causes collision when approving new orders.

-- Run this in production:

-- First, let's see the max SI number (extracting just the 6-digit part)
-- SI26000001 -> 1, SI26000003-01 -> 3

INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
SELECT 
    'e08f8574-e787-482b-b9fc-2b1551720056'::uuid as company_id,
    'SI' as doc_type,
    2026 as year,
    6 as next_seq, -- Max is SI26000005-01, so next should be 6
    NOW() as last_used_at
ON CONFLICT (company_id, doc_type, year)
DO UPDATE SET next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq), updated_at = NOW();

-- Verify:
SELECT * FROM doc_sequences WHERE year = 2026 ORDER BY doc_type;

-- =====================================================
-- FIX 2: Fix master_banner_configs RLS policy
-- =====================================================
-- The INSERT policy is too restrictive - it requires org_id to match user's org
-- But when upserting, we need to allow the insert

-- Drop and recreate the INSERT policy with a simpler check
DROP POLICY IF EXISTS "HQ admins can insert master banner config" ON public.master_banner_configs;

CREATE POLICY "HQ admins can insert master banner config"
    ON public.master_banner_configs
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            JOIN public.roles r ON u.role_code = r.role_code
            WHERE u.id = auth.uid()
            AND o.org_type_code = 'HQ'
            AND r.role_level <= 30
        )
        AND org_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
    );

-- Also fix the UPDATE policy to be clearer
DROP POLICY IF EXISTS "HQ admins can update master banner config" ON public.master_banner_configs;

CREATE POLICY "HQ admins can update master banner config"
    ON public.master_banner_configs
    FOR UPDATE
    USING (
        org_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.organizations o ON u.organization_id = o.id
            JOIN public.roles r ON u.role_code = r.role_code
            WHERE u.id = auth.uid()
            AND o.org_type_code = 'HQ'
            AND r.role_level <= 30
        )
    )
    WITH CHECK (
        org_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
    );
