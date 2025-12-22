ALTER TABLE public.redeem_items ADD COLUMN IF NOT EXISTS additional_images jsonb DEFAULT '[]'::jsonb;
