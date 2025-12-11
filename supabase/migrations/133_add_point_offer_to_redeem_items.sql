ALTER TABLE public.redeem_items
ADD COLUMN IF NOT EXISTS point_offer INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.redeem_items.point_offer IS 'Discounted point value. If set, this value is used for redemption instead of points_required.';
