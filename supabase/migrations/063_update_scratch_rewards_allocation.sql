-- Migration: 063_update_scratch_rewards_allocation.sql

-- 1. Add allocation columns to scratch_card_rewards
ALTER TABLE scratch_card_rewards
ADD COLUMN IF NOT EXISTS quantity_allocated INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS quantity_remaining INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Make probability nullable (since we are moving away from it, but keeping for legacy)
ALTER TABLE scratch_card_rewards
ALTER COLUMN probability DROP NOT NULL,
ALTER COLUMN probability SET DEFAULT NULL;

-- 3. Update existing rows to set quantity_allocated from product_quantity if type is product
UPDATE scratch_card_rewards
SET quantity_allocated = product_quantity,
    quantity_remaining = product_quantity
WHERE type = 'product';

-- 4. Update play_scratch_card_turn RPC to use quantity-based weighting
CREATE OR REPLACE FUNCTION play_scratch_card_turn(
    p_campaign_id UUID DEFAULT NULL,
    p_consumer_phone TEXT DEFAULT NULL,
    p_qr_code_id UUID DEFAULT NULL,
    p_journey_config_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign RECORD;
    v_reward RECORD;
    v_total_weight INT := 0;
    v_random_val INT;
    v_cumulative_weight INT := 0;
    v_selected_reward_id UUID;
    v_play_id UUID;
    v_plays_today INT;
    v_plays_total INT;
    v_total_allocated INT;
    v_no_prize_quantity INT;
    v_no_prize_remaining INT;
    v_total_plays_campaign INT;
    v_plays_count_campaign INT;
BEGIN
    -- 1. Get Campaign & Validate
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

    -- Re-assign ID
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

    -- 2. Check Limits
    -- Daily Limit
    SELECT COUNT(*) INTO v_plays_today 
    FROM scratch_card_plays 
    WHERE campaign_id = p_campaign_id 
    AND consumer_phone = p_consumer_phone
    AND played_at >= CURRENT_DATE;

    IF v_campaign.max_plays_per_day IS NOT NULL AND v_plays_today >= v_campaign.max_plays_per_day THEN
        RETURN jsonb_build_object('error', 'Daily play limit reached', 'code', 'DAILY_LIMIT_REACHED');
    END IF;

    -- Total Consumer Limit
    IF v_campaign.max_plays_total_per_consumer IS NOT NULL THEN
        SELECT COUNT(*) INTO v_plays_total
        FROM scratch_card_plays 
        WHERE campaign_id = p_campaign_id 
        AND consumer_phone = p_consumer_phone;

        IF v_plays_total >= v_campaign.max_plays_total_per_consumer THEN
            RETURN jsonb_build_object('error', 'Total play limit reached', 'code', 'TOTAL_LIMIT_REACHED');
        END IF;
    END IF;

    -- Total Campaign Plays Limit (Global)
    SELECT COUNT(*) INTO v_plays_count_campaign FROM scratch_card_plays WHERE campaign_id = p_campaign_id;
    
    IF v_campaign.max_total_plays IS NOT NULL AND v_plays_count_campaign >= v_campaign.max_total_plays THEN
         RETURN jsonb_build_object('error', 'Campaign has reached maximum plays', 'code', 'CAMPAIGN_LIMIT_REACHED');
    END IF;

    -- 3. Calculate Weights (Quantity Based)
    
    -- Get total allocated rewards (excluding no_prize type if any manually added, though we expect auto)
    SELECT COALESCE(SUM(quantity_remaining), 0) INTO v_total_allocated 
    FROM scratch_card_rewards 
    WHERE campaign_id = p_campaign_id 
    AND is_active = true 
    AND type != 'no_prize';

    -- Calculate implicit No Prize remaining
    -- No Prize Remaining = (Max Total Plays - Total Allocated Initial) - (No Prize Wins So Far)
    -- Actually simpler: No Prize Remaining = (Max Total Plays - Plays So Far) - (Total Allocated Remaining)
    -- Wait, if Max Total Plays is 100. Allocated is 10. 
    -- Initial No Prize = 90.
    -- After 1 play (win product): Plays=1. Allocated Remaining=9. No Prize Remaining = (100 - 1) - 9 = 90. Correct.
    -- After 1 play (no prize): Plays=1. Allocated Remaining=10. No Prize Remaining = (100 - 1) - 10 = 89. Correct.
    
    v_total_plays_campaign := COALESCE(v_campaign.max_total_plays, 1000000); -- Default to high number if unlimited? No, quantity based needs a limit.
    
    -- If max_total_plays is not set, we can't really calculate "No Prize" quantity easily unless we assume infinite no prize?
    -- The prompt says "Total Plays comes from ... Max Total Plays (Campaign) field". So we assume it's set.
    
    v_no_prize_remaining := (v_total_plays_campaign - v_plays_count_campaign) - v_total_allocated;
    
    IF v_no_prize_remaining < 0 THEN v_no_prize_remaining := 0; END IF;

    -- Create temp table for selection
    CREATE TEMP TABLE temp_weights (
        id UUID,
        type TEXT,
        weight INT
    ) ON COMMIT DROP;

    -- Insert active rewards
    INSERT INTO temp_weights (id, type, weight)
    SELECT id, type, quantity_remaining
    FROM scratch_card_rewards
    WHERE campaign_id = p_campaign_id 
    AND is_active = true 
    AND type != 'no_prize'
    AND quantity_remaining > 0;

    -- Insert implicit No Prize
    IF v_no_prize_remaining > 0 THEN
        INSERT INTO temp_weights (id, type, weight)
        VALUES (NULL, 'no_prize', v_no_prize_remaining);
    END IF;

    -- Calculate Total Weight
    SELECT SUM(weight) INTO v_total_weight FROM temp_weights;

    IF v_total_weight IS NULL OR v_total_weight = 0 THEN
        -- No rewards left and no plays left? Or just everything exhausted.
        RETURN jsonb_build_object('error', 'No rewards or plays available', 'code', 'GAME_OVER');
    END IF;

    -- Weighted Random Selection
    v_random_val := floor(random() * v_total_weight);
    
    FOR v_reward IN SELECT * FROM temp_weights ORDER BY type DESC LOOP -- Order doesn't strictly matter but consistent
        v_cumulative_weight := v_cumulative_weight + v_reward.weight;
        IF v_random_val < v_cumulative_weight THEN
            v_selected_reward_id := v_reward.id;
            -- If id is NULL, it's the implicit no_prize
            IF v_selected_reward_id IS NULL THEN
                v_reward.type := 'no_prize';
                v_reward.name := 'Better luck next time!'; -- Default
            ELSE
                -- Fetch actual reward details
                SELECT * INTO v_reward FROM scratch_card_rewards WHERE id = v_selected_reward_id;
            END IF;
            EXIT;
        END IF;
    END LOOP;

    -- 4. Process Selection (Decrement Stock)
    IF v_reward.type != 'no_prize' AND v_selected_reward_id IS NOT NULL THEN
        UPDATE scratch_card_rewards 
        SET quantity_remaining = quantity_remaining - 1,
            product_quantity = CASE WHEN type = 'product' THEN product_quantity - 1 ELSE product_quantity END
        WHERE id = v_selected_reward_id AND quantity_remaining > 0;
        
        IF NOT FOUND THEN
             -- Race condition: failed to decrement
             -- Fallback to no_prize
             v_reward.type := 'no_prize';
             v_reward.name := 'Better luck next time!';
             v_selected_reward_id := NULL;
        END IF;
    END IF;

    -- 5. Record Play
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
        (v_reward.type != 'no_prize'),
        NOW()
    ) RETURNING id INTO v_play_id;

    -- 6. Return Result
    RETURN jsonb_build_object(
        'status', CASE WHEN v_reward.type = 'no_prize' THEN 'no_prize' ELSE 'win' END,
        'reward_name', v_reward.name,
        'reward_type', v_reward.type,
        'points_value', CASE WHEN v_reward.type = 'points' THEN v_reward.value_points ELSE NULL END,
        'reward_image_url', CASE WHEN v_reward.type = 'product' OR v_reward.type = 'mystery' THEN v_reward.image_url ELSE NULL END,
        'play_id', v_play_id,
        'message', CASE WHEN v_reward.type = 'no_prize' THEN 
            COALESCE(v_campaign.theme_config->>'no_prize_message', 'Better luck next time!')
        ELSE 
            REPLACE(COALESCE(v_campaign.theme_config->>'success_message', 'You won: {{reward_name}}'), '{{reward_name}}', v_reward.name)
        END
    );
END;
$$;
