-- Migration: Add generate_po_number function
-- Description: Creates a function to generate Purchase Order numbers.
-- Format: PO-{ORG_CODE}-{YYYYMMDD}-{SEQ}

CREATE OR REPLACE FUNCTION public.generate_po_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_code text;
    v_date_str text;
    v_count integer;
    v_po_number text;
BEGIN
    -- Get organization code
    SELECT org_code INTO v_org_code
    FROM public.organizations
    WHERE id = p_org_id;
    
    -- Default to 'ORG' if no code found
    IF v_org_code IS NULL THEN
        v_org_code := 'ORG';
    END IF;
    
    -- Get current date as YYYYMMDD
    v_date_str := to_char(now(), 'YYYYMMDD');
    
    -- Count existing POs for this org today to generate sequence
    -- We look for POs starting with PO-{ORG_CODE}-{YYYYMMDD}-
    SELECT count(*) INTO v_count
    FROM public.orders
    WHERE buyer_org_id = p_org_id
      AND po_doc_no LIKE 'PO-' || v_org_code || '-' || v_date_str || '-%';
      
    -- Generate PO Number: PO-CODE-YYYYMMDD-001
    v_po_number := 'PO-' || v_org_code || '-' || v_date_str || '-' || lpad((v_count + 1)::text, 3, '0');
    
    RETURN v_po_number;
END;
$$;
