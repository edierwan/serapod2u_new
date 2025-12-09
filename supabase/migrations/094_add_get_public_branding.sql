DROP FUNCTION IF EXISTS get_public_branding();

CREATE OR REPLACE FUNCTION get_public_branding()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    branding_data json;
BEGIN
    SELECT json_build_object(
        'logoUrl', o.logo_url,
        'loginTitle', o.settings->>'loginTitle',
        'loginSubtitle', o.settings->>'loginSubtitle',
        'copyrightText', o.settings->>'copyrightText',
        'updatedAt', o.updated_at
    ) INTO branding_data
    FROM organizations o
    WHERE o.org_type_code = 'HQ'
    LIMIT 1;

    RETURN branding_data;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_branding() TO anon;
GRANT EXECUTE ON FUNCTION get_public_branding() TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_branding() TO service_role;
