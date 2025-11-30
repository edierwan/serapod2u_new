-- Add custom title, description, and icon columns for journey features
ALTER TABLE public.journey_configurations
ADD COLUMN IF NOT EXISTS points_title text DEFAULT 'Collect Points',
ADD COLUMN IF NOT EXISTS points_description text DEFAULT 'Earn rewards with every scan',
ADD COLUMN IF NOT EXISTS points_icon text DEFAULT 'Coins',

ADD COLUMN IF NOT EXISTS lucky_draw_title text DEFAULT 'Lucky Draw',
ADD COLUMN IF NOT EXISTS lucky_draw_description text DEFAULT 'Try your luck and win prizes!',
ADD COLUMN IF NOT EXISTS lucky_draw_icon text DEFAULT 'Star',

ADD COLUMN IF NOT EXISTS redemption_title text DEFAULT 'Claim Free Gift',
ADD COLUMN IF NOT EXISTS redemption_description text DEFAULT 'Get your free gift at the shop',
ADD COLUMN IF NOT EXISTS redemption_icon text DEFAULT 'Gift',

ADD COLUMN IF NOT EXISTS scratch_card_title text DEFAULT 'Scratch Card Game',
ADD COLUMN IF NOT EXISTS scratch_card_description text DEFAULT 'Scratch & win surprise rewards',
ADD COLUMN IF NOT EXISTS scratch_card_icon text DEFAULT 'Gift';
