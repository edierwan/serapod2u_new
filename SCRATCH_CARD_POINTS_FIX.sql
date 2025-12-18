-- SCRATCH CARD POINTS FIX
-- This SQL adds support for game_win transaction type and fixes the play_scratch_card_turn function
-- to properly save points when a user wins

-- 1. Add game_win to allowed transaction types
ALTER TABLE points_transactions 
DROP CONSTRAINT IF EXISTS points_transactions_transaction_type_check;

ALTER TABLE points_transactions 
ADD CONSTRAINT points_transactions_transaction_type_check 
CHECK (transaction_type = ANY (ARRAY['earn'::text, 'redeem'::text, 'expire'::text, 'adjust'::text, 'game_win'::text]));

-- 2. Updated play_scratch_card_turn function that saves points to database
CREATE OR REPLACE FUNCTION public.play_scratch_card_turn(
    p_campaign_id uuid DEFAULT NULL::uuid, 
    p_consumer_phone text DEFAULT NULL::text, 
    p_qr_code_id uuid DEFAULT NULL::uuid, 
    p_journey_config_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_campaign RECORD;
    v_reward RECORD;
    v_total_prob FLOAT := 0;
    v_random_val FLOAT;
    v_cumulative_prob FLOAT := 0;
    v_selected_reward_id UUID;
    v_play_id UUID;
    v_plays_today INT;
    v_plays_total INT;
    v_plays_qr INT;
    v_user_org_id UUID;
    v_transaction_id UUID;
    v_current_balance INT;
BEGIN
    IF p_campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM scratch_card_campaigns WHERE id = p_campaign_id;
    ELSIF p_journey_config_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM scratch_card_campaigns 
        WHERE journey_config_id = p_journey_config_id 
        AND status = 'active'
        LIMIT 1;
    ELSE
        RETURN jsonb_build_object('error', 'Campaign ID or Journey Config ID required', 'code', 'MISSING_ID');
    END IF;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Campaign not found', 'code', 'CAMPAIGN_NOT_FOUND');
    END IF;

    p_campaign_id := v_campaign.id;

    IF v_campaign.status != 'active' THEN
        RETURN jsonb_build_object('error', 'Campaign is not active', 'code', 'CAMPAIGN_NOT_ACTIVE');
    END IF;

    IF v_campaign.start_at IS NOT NULL AND NOW() < v_campaign.start_at THEN
        RETURN jsonb_build_object('error', 'Campaign has not started', 'code', 'CAMPAIGN_NOT_STARTED');
    END IF;

    IF v_campaign.end_at IS NOT NULL AND NOW() > v_campaign.end_at THEN
        RETURN jsonb_build_object('error', 'Campaign has ended', 'code', 'CAMPAIGN_ENDED');
    END IF;

    SELECT COUNT(*) INTO v_plays_today 
    FROM scratch_card_plays 
    WHERE campaign_id = p_campaign_id 
    AND consumer_phone = p_consumer_phone
    AND played_at >= CURRENT_DATE;

    IF v_campaign.max_plays_per_day IS NOT NULL AND v_plays_today >= v_campaign.max_plays_per_day THEN
        RETURN jsonb_build_object('error', 'Daily play limit reached', 'code', 'DAILY_LIMIT_REACHED');
    END IF;

    IF v_campaign.max_plays_total_per_consumer IS NOT NULL THEN
        SELECT COUNT(*) INTO v_plays_total
        FROM scratch_card_plays 
        WHERE campaign_id = p_campaign_id 
        AND consumer_phone = p_consumer_phone;

        IF v_plays_total >= v_campaign.max_plays_total_per_consumer THEN
            RETURN jsonb_build_object('error', 'Total play limit reached', 'code', 'TOTAL_LIMIT_REACHED');
        END IF;
    END IF;

    IF p_qr_code_id IS NOT NULL AND v_campaign.plays_per_qr IS NOT NULL THEN
        SELECT COUNT(*) INTO v_plays_qr
        FROM scratch_card_plays
        WHERE campaign_id = p_campaign_id
        AND qr_code_id = p_qr_code_id;

        IF v_plays_qr >= v_campaign.plays_per_qr THEN
             RETURN jsonb_build_object('error', 'QR play limit reached', 'code', 'QR_LIMIT_REACHED');
        END IF;
    END IF;

    CREATE TEMP TABLE temp_eligible_rewards ON COMMIT DROP AS
    SELECT * FROM scratch_card_rewards 
    WHERE campaign_id = p_campaign_id 
    AND is_active = true
    AND (
        (type = 'product' AND quantity_remaining > 0)
        OR
        (type != 'product' AND (quantity_allocated = 0 OR quantity_remaining > 0))
    );

    IF NOT EXISTS (SELECT 1 FROM temp_eligible_rewards) THEN
        RETURN jsonb_build_object('error', 'No rewards available', 'code', 'NO_REWARDS');
    END IF;

    SELECT SUM(COALESCE(quantity_remaining, 0)) INTO v_total_prob FROM temp_eligible_rewards;
    
    IF v_total_prob IS NULL OR v_total_prob = 0 THEN
         SELECT id INTO v_selected_reward_id 
         FROM temp_eligible_rewards 
         WHERE quantity_allocated = 0 
         LIMIT 1;
         
         IF v_selected_reward_id IS NULL THEN
            SELECT id INTO v_selected_reward_id FROM temp_eligible_rewards ORDER BY random() LIMIT 1;
         END IF;
    ELSE
        v_random_val := floor(random() * v_total_prob);
        
        SELECT id INTO v_selected_reward_id
        FROM (
            SELECT id, SUM(COALESCE(quantity_remaining, 0)) OVER (ORDER BY id) as cum_prob
            FROM temp_eligible_rewards
        ) t
        WHERE cum_prob > v_random_val
        LIMIT 1;
    END IF;

    SELECT 
        r.*,
        pv.image_url as variant_image_url,
        p.product_name as product_name,
        pv.variant_name as variant_name
    INTO v_reward 
    FROM scratch_card_rewards r
    LEFT JOIN product_variants pv ON r.variant_id = pv.id
    LEFT JOIN products p ON r.product_id = p.id
    WHERE r.id = v_selected_reward_id;

    INSERT INTO scratch_card_plays (
        campaign_id,
        qr_code_id,
        consumer_phone,
        reward_id,
        is_win,
        played_at
    ) VALUES (
        p_campaign_id,
        p_qr_code_id,
        p_consumer_phone,
        v_selected_reward_id,
        v_reward.type != 'no_prize',
        NOW()
    ) RETURNING id INTO v_play_id;

    IF v_reward.quantity_allocated > 0 THEN
        UPDATE scratch_card_rewards
        SET quantity_remaining = quantity_remaining - 1
        WHERE id = v_selected_reward_id;
    END IF;

    -- NEW: Save points to points_transactions table when user wins points
    IF v_reward.type = 'points' AND v_reward.value_points > 0 AND p_consumer_phone IS NOT NULL THEN
        SELECT organization_id INTO v_user_org_id 
        FROM users 
        WHERE phone = p_consumer_phone 
        LIMIT 1;
        
        IF v_user_org_id IS NOT NULL THEN
            SELECT COALESCE(current_balance, 0) INTO v_current_balance
            FROM v_shop_points_balance
            WHERE shop_id = v_user_org_id;
            
            IF v_current_balance IS NULL THEN
                v_current_balance := 0;
            END IF;

            INSERT INTO points_transactions (
                id,
                company_id,
                consumer_phone,
                transaction_type,
                points_amount,
                balance_after,
                qr_code_id,
                description,
                transaction_date,
                created_at
            ) VALUES (
                gen_random_uuid(),
                v_user_org_id,
                p_consumer_phone,
                'game_win',
                v_reward.value_points,
                v_current_balance + v_reward.value_points,
                p_qr_code_id,
                'Won ' || v_reward.value_points || ' points from Scratch Card: ' || COALESCE(v_reward.name, 'Game Reward'),
                NOW(),
                NOW()
            ) RETURNING id INTO v_transaction_id;
            
            UPDATE scratch_card_plays
            SET is_claimed = true,
                claimed_at = NOW(),
                shop_id = v_user_org_id,
                claim_details = jsonb_build_object('auto_claimed', true, 'transaction_id', v_transaction_id)
            WHERE id = v_play_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'play_id', v_play_id,
        'reward', jsonb_build_object(
            'id', v_reward.id,
            'name', v_reward.name,
            'type', v_reward.type,
            'value_points', v_reward.value_points,
            'image_url', COALESCE(v_reward.image_url, v_reward.variant_image_url),
            'product_name', v_reward.product_name,
            'variant_name', v_reward.variant_name
        ),
        'points_added', CASE 
            WHEN v_reward.type = 'points' AND v_reward.value_points > 0 AND v_user_org_id IS NOT NULL 
            THEN true 
            ELSE false 
        END
    );
END;
$function$;

-- 3. Note: v_shop_points_balance view is already updated to track game_win transactions
-- It sums game_win points in total_game_wins and counts them in game_win_count
