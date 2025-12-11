-- Fix RLS violation when generating document numbers
-- Make generate_doc_number SECURITY DEFINER so it can access doc_counters table
-- regardless of user role (since doc_counters is restricted to HQ Admin)

CREATE OR REPLACE FUNCTION public.generate_doc_number(p_company_id uuid, p_prefix text, p_order_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_yymm   TEXT;
  v_scope  TEXT;
  v_seq    INTEGER;
  v_doc_no TEXT;
BEGIN
  -- Current month/year in MMYY
  v_yymm := TO_CHAR(CURRENT_DATE, 'MMYY');

  -- Scope groups counters by company + doc kind + order type + month
  v_scope := p_prefix || '-' || p_order_type || '-' || v_yymm;

  -- Atomically get and increment the per-scope monthly counter
  INSERT INTO public.doc_counters (company_id, scope_code, yymm, next_seq)
  VALUES (p_company_id, v_scope, v_yymm, 1)
  ON CONFLICT (company_id, scope_code, yymm)
  DO UPDATE SET
    next_seq = public.doc_counters.next_seq + 1,
    updated_at = NOW()
  RETURNING next_seq INTO v_seq;

  -- Format: PREFIX-TYPE-MMYY-SEQ (e.g. ORD-D2H-1225-01)
  v_doc_no := p_prefix || '-' || p_order_type || '-' || v_yymm || '-' || LPAD(v_seq::TEXT, 2, '0');

  RETURN v_doc_no;
END;
$function$;
