-- Return Product: add two new return reasons (additive, idempotent).
-- Requested: Authority Change (KKM), Packaging Change.
-- Existing reasons and return workflow logic are unchanged.

BEGIN;

INSERT INTO public.return_reasons (code, label, sort_order, is_active)
VALUES
  ('authority_seizure', 'Authority Change (KKM)', 70, true),
  ('packaging_change',  'Packaging Change',       80, true)
ON CONFLICT (code) DO UPDATE
SET
  label = EXCLUDED.label,
  is_active = true,
  sort_order = EXCLUDED.sort_order;

-- Keep Other at the end of the dropdown.
UPDATE public.return_reasons
SET sort_order = 90
WHERE code = 'other'
  AND sort_order < 90;

COMMIT;
