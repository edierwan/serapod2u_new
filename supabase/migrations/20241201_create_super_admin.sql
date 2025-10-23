-- Insert super admin user into public.users table
-- This should match the UUID you provided: 1bd978bb-4f56-4d02-b4e0-48220413e242

-- First, ensure we have the SERA organization
INSERT INTO public.organizations (id, org_code, org_name, org_type_code, address, city, state, postal_code, country, phone, email, website, is_active, created_at, updated_at)
VALUES (
  'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  'SERA',
  'Sera Pod Headquarters',
  'HQ',
  'Kuala Lumpur',
  'Kuala Lumpur',
  'Wilayah Persekutuan',
  '50000',
  'Malaysia',
  '+60-3-12345678',
  'admin@serapod.com',
  'https://serapod.com',
  true,
  NOW(),
  NOW()
) ON CONFLICT (org_code) DO UPDATE SET
  org_name = EXCLUDED.org_name,
  updated_at = NOW();

-- Ensure we have the SUPERADMIN role
INSERT INTO public.roles (role_code, role_name, role_level, description, permissions, is_active, created_at, updated_at)
VALUES (
  'SUPERADMIN',
  'Super Administrator',
  99,
  'Full system access with all permissions',
  '["all"]',
  true,
  NOW(),
  NOW()
) ON CONFLICT (role_code) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  role_level = EXCLUDED.role_level,
  updated_at = NOW();

-- Insert the super admin user
INSERT INTO public.users (
  id,
  email,
  full_name,
  phone,
  role_code,
  organization_id,
  is_active,
  email_verified,
  last_login_at,
  created_at,
  updated_at
) VALUES (
  '1bd978bb-4f56-4d02-b4e0-48220413e242',
  'super@dev.com',
  'Super Administrator',
  '+60-12-3456789',
  'SUPERADMIN',
  'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  true,
  true,
  NULL,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role_code = EXCLUDED.role_code,
  organization_id = EXCLUDED.organization_id,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Verify the user was created correctly
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.role_code,
  r.role_name,
  r.role_level,
  o.org_name,
  o.org_code,
  u.is_active
FROM public.users u
JOIN public.roles r ON u.role_code = r.role_code
JOIN public.organizations o ON u.organization_id = o.id
WHERE u.email = 'super@dev.com';