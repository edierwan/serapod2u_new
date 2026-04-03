-- Add new fields to organizations table for shop bulk import.
-- These columns capture product-availability flags and related metadata
-- from field survey CSV files.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS branch              text,
  ADD COLUMN IF NOT EXISTS sells_serapod_flavour boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sells_sbox            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sells_sbox_special_edition boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hot_flavour_brands    text;

COMMENT ON COLUMN public.organizations.branch IS 'Branch name or location variant';
COMMENT ON COLUMN public.organizations.sells_serapod_flavour IS 'Whether the shop sells Serapod flavour products';
COMMENT ON COLUMN public.organizations.sells_sbox IS 'Whether the shop sells S.Box products';
COMMENT ON COLUMN public.organizations.sells_sbox_special_edition IS 'Whether the shop sells S.Box Special Edition products';
COMMENT ON COLUMN public.organizations.hot_flavour_brands IS 'Comma-separated list of hot flavour brands sold';

-- Fix: generate_signature_hash needs extensions schema for pgcrypto digest()
ALTER FUNCTION public.generate_signature_hash SET search_path = public, extensions;
ALTER FUNCTION public.fn_create_otp SET search_path = public, extensions;
ALTER FUNCTION public.fn_verify_otp SET search_path = public, extensions;
ALTER FUNCTION public.wms_record_movement_from_summary SET search_path = public, extensions;
