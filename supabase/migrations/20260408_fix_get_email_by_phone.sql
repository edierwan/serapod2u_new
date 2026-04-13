-- Fix get_email_by_phone to search public.users instead of auth.users
-- Root cause: after password reset (which finds user via public.users.phone),
-- the Collect Points flow resolved phone via auth.users.phone — these can
-- return different results or NULL for email-only signups.
-- Also adds proper phone normalization to try multiple formats.

CREATE OR REPLACE FUNCTION public.get_email_by_phone(p_phone text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
  v_cleaned text;
  v_with_plus text;
BEGIN
  -- Normalize input: strip non-digits except leading +
  v_cleaned := regexp_replace(p_phone, '[^0-9]', '', 'g');

  -- Handle local Malaysian format: 01x -> 601x
  IF v_cleaned LIKE '0%' THEN
    v_cleaned := '60' || substr(v_cleaned, 2);
  END IF;

  v_with_plus := '+' || v_cleaned;

  -- Search public.users (consistent with password reset flow)
  SELECT email INTO v_email
  FROM public.users
  WHERE is_active = true
    AND (phone = v_cleaned
      OR phone = v_with_plus
      OR phone = p_phone)
  LIMIT 1;

  RETURN v_email;
END;
$$;
