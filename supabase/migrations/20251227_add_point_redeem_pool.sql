-- Migration to add Point Redeem Pool support to Loyalty > Redeem

-- 1. Modify redemption_gifts table to support new types
ALTER TABLE public.redemption_gifts
ADD COLUMN IF NOT EXISTS redeem_type text DEFAULT 'order', -- 'order' or 'master'
ADD COLUMN IF NOT EXISTS category text DEFAULT 'gift', -- 'gift' or 'point_pool'
ADD COLUMN IF NOT EXISTS points_per_collection integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_points_allocated integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_points integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS collection_option_1 boolean DEFAULT false, -- Option 1: Per user only
ADD COLUMN IF NOT EXISTS collection_option_2 boolean DEFAULT false, -- Option 2: Everyday
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active', -- 'active', 'expired', 'scheduled'
ADD COLUMN IF NOT EXISTS start_date timestamptz,
ADD COLUMN IF NOT EXISTS end_date timestamptz;

-- Make order_id nullable for Master Redeem
ALTER TABLE public.redemption_gifts
ALTER COLUMN order_id DROP NOT NULL;

-- 2. Modify redeem_gift_transactions to support user tracking
ALTER TABLE public.redeem_gift_transactions
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Make order_id nullable in transactions (for Master Redeem transactions)
ALTER TABLE public.redeem_gift_transactions
ALTER COLUMN order_id DROP NOT NULL;

-- Add index for status and user lookups
CREATE INDEX IF NOT EXISTS idx_redemption_gifts_status ON public.redemption_gifts(status);
CREATE INDEX IF NOT EXISTS idx_redeem_gift_transactions_user_id ON public.redeem_gift_transactions(user_id);

-- 3. Create function to claim Point Redeem Pool reward
CREATE OR REPLACE FUNCTION public.claim_point_redeem_pool(
  p_redeem_gift_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gift public.redemption_gifts%ROWTYPE;
  v_points integer;
  v_already_claimed boolean;
  v_daily_claimed boolean;
  v_transaction_id uuid;
  v_user_phone text;
  v_current_balance integer;
  v_user_details record;
BEGIN
  -- Lock the gift row for update to ensure atomicity
  SELECT * INTO v_gift
  FROM public.redemption_gifts
  WHERE id = p_redeem_gift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Redeem gift not found');
  END IF;

  -- Logic checks
  IF v_gift.category <> 'point_pool' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not a point pool redeem');
  END IF;

  -- Status check (simple)
  IF v_gift.status <> 'active' THEN
     RETURN jsonb_build_object('success', false, 'message', 'Redeem pool is not active');
  END IF;
  
  -- Date checks
  IF v_gift.start_date IS NOT NULL AND v_gift.start_date > NOW() THEN
     RETURN jsonb_build_object('success', false, 'message', 'Redeem pool has not started yet');
  END IF;
  
  IF v_gift.end_date IS NOT NULL AND v_gift.end_date < NOW() THEN
     RETURN jsonb_build_object('success', false, 'message', 'Redeem pool has ended');
  END IF;

  v_points := COALESCE(v_gift.points_per_collection, 0);

  -- Check pool availability
  IF v_gift.remaining_points < v_points THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sold out / expired');
  END IF;

  -- User Claim Limits
  -- Option 1: Per user only (once ever)
  IF v_gift.collection_option_1 AND NOT v_gift.collection_option_2 THEN
    SELECT EXISTS(
      SELECT 1 FROM public.redeem_gift_transactions
      WHERE redeem_gift_id = p_redeem_gift_id AND user_id = p_user_id
    ) INTO v_already_claimed;
    
    IF v_already_claimed THEN
      RETURN jsonb_build_object('success', false, 'message', 'You have already collected this reward.');
    END IF;
  END IF;

  -- Option 2: Daily (once per day)
  IF v_gift.collection_option_2 THEN
    SELECT EXISTS(
      SELECT 1 FROM public.redeem_gift_transactions
      WHERE redeem_gift_id = p_redeem_gift_id 
        AND user_id = p_user_id
        AND redeemed_at >= CURRENT_DATE::timestamptz
        AND redeemed_at < (CURRENT_DATE + 1)::timestamptz
    ) INTO v_daily_claimed;
    
    IF v_daily_claimed THEN
      RETURN jsonb_build_object('success', false, 'message', 'You have already collected this reward today.');
    END IF;
  END IF;

  -- Decrement Pool and Update
  -- If remaining points will be less than points per collection after this claim, mark as expired? 
  -- Or just let it go to < points per collection and fail next time. 
  -- Prompt says: "If remaining_points < points_per_claim after decrement, mark pool status = expired"
  UPDATE public.redemption_gifts
  SET remaining_points = remaining_points - v_points,
      status = CASE 
                 WHEN (remaining_points - v_points) < points_per_collection THEN 'expired'
                 ELSE status 
               END,
      updated_at = NOW()
  WHERE id = p_redeem_gift_id;

  -- Get User Phone for transactions
  SELECT phone, email INTO v_user_details FROM public.users WHERE id = p_user_id;
  v_user_phone := COALESCE(v_user_details.phone, 'N/A');

  -- Record Transaction in redeem_gift_transactions
  INSERT INTO public.redeem_gift_transactions (
    redeem_gift_id,
    user_id,
    redeemed_at,
    consumer_phone,
    qr_code, -- Not a real QR, but required field
    order_id
  ) VALUES (
    p_redeem_gift_id,
    p_user_id,
    NOW(),
    v_user_phone,
    'POOL-' || encode(gen_random_bytes(6), 'hex'), -- Placeholder unique-ish code
    v_gift.order_id -- Could be null
  ) RETURNING id INTO v_transaction_id;
  
  -- Award Points (Insert into points_transactions)
  -- Get current balance
  SELECT balance_after INTO v_current_balance
  FROM public.points_transactions
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;
  
  v_current_balance := COALESCE(v_current_balance, 0);

  INSERT INTO public.points_transactions (
    user_id,
    consumer_phone,
    consumer_email,
    transaction_type,
    points_amount,
    balance_after,
    description,
    redeem_item_id, -- Link to the gift
    transaction_date,
    company_id -- Maybe needed? If user has company_id?
  ) VALUES (
    p_user_id,
    v_user_phone,
    v_user_details.email,
    'earn',
    v_points,
    v_current_balance + v_points,
    'Redeemed Pool Reward: ' || v_gift.gift_name,
    p_redeem_gift_id,
    NOW(),
    NULL -- Or find relevant company_id
  );

  RETURN jsonb_build_object('success', true, 'points_earned', v_points, 'message', 'Success');
END;
$$;
