BEGIN;

-- Newsletter updates can also announce offers and free shipping.
DO $$
BEGIN
  IF to_regclass('public.outdoor_admin_updates') IS NOT NULL THEN
    ALTER TABLE public.outdoor_admin_updates DROP CONSTRAINT IF EXISTS outdoor_admin_updates_kind_chk;
    ALTER TABLE public.outdoor_admin_updates
      ADD CONSTRAINT outdoor_admin_updates_kind_chk
      CHECK (kind IN ('product', 'color', 'offer', 'shipping', 'event', 'other'));
  END IF;
END $$;

COMMIT;
