-- Initial data setup for Serapod2U Supply Chain Management
-- This script creates the necessary roles, organizations, and users for the system

-- Insert Role Types
INSERT INTO public.roles (role_code, role_name, role_level, description, is_active, created_at, updated_at) VALUES
('SUPERADMIN', 'Super Administrator', 1, 'Full system access with all privileges', true, now(), now()),
('SUPER', 'Super Administrator', 1, 'Full system access with all privileges', true, now(), now()),
('HQ_ADMIN', 'HQ Administrator', 10, 'Headquarters administrator with organization-wide access', true, now(), now()),
('MANU_ADMIN', 'Manufacturer Administrator', 20, 'Manufacturer organization administrator', true, now(), now()),
('DIST_ADMIN', 'Distributor Administrator', 30, 'Distributor organization administrator', true, now(), now()),
('WH_MANAGER', 'Warehouse Manager', 40, 'Warehouse operations manager', true, now(), now()),
('SHOP_MANAGER', 'Shop Manager', 50, 'Retail shop manager', true, now(), now()),
('USER', 'Standard User', 60, 'Standard system user with limited access', true, now(), now()),
('GUEST', 'Guest User', 70, 'Guest access with read-only permissions', true, now(), now())
ON CONFLICT (role_code) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  role_level = EXCLUDED.role_level,
  description = EXCLUDED.description,
  updated_at = now();

-- Insert Organization Types
INSERT INTO public.organization_types (type_code, type_name, description, hierarchy_level, is_active, created_at, updated_at) VALUES
('HQ', 'Headquarters', 'Corporate headquarters and main office', 1, true, now(), now()),
('MANU', 'Manufacturer', 'Manufacturing facilities and operations', 2, true, now(), now()),
('DIST', 'Distributor', 'Distribution centers and wholesale operations', 3, true, now(), now()),
('WH', 'Warehouse', 'Storage and logistics facilities', 4, true, now(), now()),
('SHOP', 'Retail Shop', 'Retail outlets and stores', 5, true, now(), now())
ON CONFLICT (type_code) DO UPDATE SET
  type_name = EXCLUDED.type_name,
  description = EXCLUDED.description,
  hierarchy_level = EXCLUDED.hierarchy_level,
  updated_at = now();

-- Insert Main HQ Organization
INSERT INTO public.organizations (
  id, org_code, org_name, org_name_short, org_type_code, parent_org_id,
  contact_person, phone_number, email, address, city, state, postal_code, country,
  is_active, is_verified, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'HQ001',
  'Serapod2U Headquarters',
  'Serapod2U HQ',
  'HQ',
  NULL,
  'System Administrator',
  '+60123456789',
  'admin@serapod2u.com',
  '123 Business Center',
  'Kuala Lumpur',
  'Federal Territory',
  '50000',
  'Malaysia',
  true,
  true,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  org_name = EXCLUDED.org_name,
  updated_at = now();

-- Insert Sample Manufacturer Organization
INSERT INTO public.organizations (
  id, org_code, org_name, org_name_short, org_type_code, parent_org_id,
  contact_person, phone_number, email, address, city, state, postal_code, country,
  is_active, is_verified, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'MANU001',
  'Vape Manufacturing Sdn Bhd',
  'VapeManu',
  'MANU',
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Manufacturing Manager',
  '+60123456790',
  'manufacturing@vapemanu.com',
  '456 Industrial Park',
  'Shah Alam',
  'Selangor',
  '40000',
  'Malaysia',
  true,
  true,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  org_name = EXCLUDED.org_name,
  updated_at = now();

-- Create or Update the super admin user
-- First, let's check if the user exists in auth.users and get their UUID
-- For this example, we'll use a placeholder UUID - this would need to be updated with the actual UUID from Supabase Auth

-- Insert Super Admin User (replace the UUID with the actual UUID from Supabase Auth)
INSERT INTO public.users (
  id, email, role_code, organization_id, full_name, phone,
  is_active, created_at, updated_at
) VALUES (
  -- This UUID needs to be replaced with the actual UUID from auth.users for super@dev.com
  '1bd978bb-4f56-4d02-b4e0-48220413e242'::uuid,
  'super@dev.com',
  'SUPER',
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Super Administrator',
  '+60123456789',
  true,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role_code = EXCLUDED.role_code,
  organization_id = EXCLUDED.organization_id,
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  is_active = true,
  updated_at = now();

-- Insert some sample product categories
INSERT INTO public.product_categories (category_code, category_name, description, is_active, created_at, updated_at) VALUES
('VAPE', 'Vaping Products', 'Electronic cigarettes and vaping accessories', true, now(), now()),
('DISP', 'Disposable Vapes', 'Single-use disposable vaping devices', true, now(), now()),
('POD', 'Pod Systems', 'Refillable pod-based vaping systems', true, now(), now()),
('ACC', 'Accessories', 'Vaping accessories and replacement parts', true, now(), now())
ON CONFLICT (category_code) DO UPDATE SET
  category_name = EXCLUDED.category_name,
  description = EXCLUDED.description,
  updated_at = now();

-- Insert sample brands
INSERT INTO public.brands (brand_code, brand_name, description, is_active, created_at, updated_at) VALUES
('ELFBAR', 'Elf Bar', 'Popular disposable vape brand', true, now(), now()),
('LOST', 'Lost Mary', 'Premium disposable vape products', true, now(), now()),
('GEEK', 'Geek Bar', 'High-quality vaping devices', true, now(), now()),
('VUSE', 'Vuse', 'Professional vaping solutions', true, now(), now())
ON CONFLICT (brand_code) DO UPDATE SET
  brand_name = EXCLUDED.brand_name,
  description = EXCLUDED.description,
  updated_at = now();

-- Insert Malaysian states
INSERT INTO public.states (state_code, state_name, country_code, is_active) VALUES
('KL', 'Kuala Lumpur', 'MY', true),
('SEL', 'Selangor', 'MY', true),
('PNG', 'Penang', 'MY', true),
('JHR', 'Johor', 'MY', true),
('PRK', 'Perak', 'MY', true),
('KDH', 'Kedah', 'MY', true),
('KEL', 'Kelantan', 'MY', true),
('TRG', 'Terengganu', 'MY', true),
('PHG', 'Pahang', 'MY', true),
('NSN', 'Negeri Sembilan', 'MY', true),
('MLK', 'Melaka', 'MY', true),
('SBH', 'Sabah', 'MY', true),
('SRW', 'Sarawak', 'MY', true),
('LBN', 'Labuan', 'MY', true),
('PJY', 'Putrajaya', 'MY', true)
ON CONFLICT (state_code) DO NOTHING;

COMMIT;