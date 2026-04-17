BEGIN;

ALTER TABLE public.shop_requests
  ADD COLUMN IF NOT EXISTS requested_org_type_code text NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS requested_parent_org_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_contact_email text NULL,
  ADD COLUMN IF NOT EXISTS requested_hot_flavour_brands text NULL,
  ADD COLUMN IF NOT EXISTS requested_sells_serapod_flavour boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_sells_sbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_sells_sbox_special_edition boolean NOT NULL DEFAULT false;

UPDATE public.shop_requests
SET requested_org_type_code = 'SHOP'
WHERE requested_org_type_code IS DISTINCT FROM 'SHOP';

COMMIT;