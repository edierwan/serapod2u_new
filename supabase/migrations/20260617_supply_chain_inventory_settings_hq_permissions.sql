-- Ensure Super Admin and HQ Admin roles can access Supply Chain Inventory Settings.
-- This keeps the change scoped to the specific permission instead of widening
-- Supply Chain access globally.
update public.roles
set permissions = jsonb_set(
  coalesce(permissions::jsonb, '{}'::jsonb),
  '{manage_inventory_settings}',
  'true'::jsonb,
  true
)
where role_level in (1, 10);

