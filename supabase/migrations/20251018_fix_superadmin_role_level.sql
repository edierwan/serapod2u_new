-- Fix SUPERADMIN role_level to be 1 (highest privilege)
-- Migration: 20251018_fix_superadmin_role_level

-- Update the SUPERADMIN role to have role_level = 1
UPDATE public.roles
SET 
  role_level = 1,
  description = 'Full system access with all privileges - Highest privilege level',
  updated_at = NOW()
WHERE role_code IN ('SUPERADMIN', 'SUPER');

-- Verify all role levels for reference
SELECT 
  role_code,
  role_name,
  role_level,
  description
FROM public.roles
ORDER BY role_level;
