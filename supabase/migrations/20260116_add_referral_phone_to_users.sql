-- Add referral_phone column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS referral_phone text;

COMMENT ON COLUMN public.users.referral_phone IS 'Phone number of the Serapod representative who referred this user';

-- Function to check if a phone number belongs to a Serapod representative
CREATE OR REPLACE FUNCTION public.check_serapod_user_phone(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM public.users u
    JOIN public.organizations o ON u.organization_id = o.id
    WHERE 
      (u.phone = p_phone OR REPLACE(u.phone, '+', '') = REPLACE(p_phone, '+', ''))
      AND u.is_active = true
      AND (
          o.org_type_code = 'HQ' 
          OR o.org_name ILIKE '%Serapod%'
      )
  ) INTO v_exists;
  
  RETURN v_exists;
END;
$$;
