-- Migration: 062_create_play_scratch_card_rpc.sql

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
    v_total_prob FLOAT := 0;
    v_random_val FLOAT;
    v_cumulative_prob FLOAT := 0;
    v_selected_reward_id UUID;
    v_play_id UUID;
    v_plays_today INT;
    v_plays_total INT;
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

    -- Re-assign ID in case we found it via journey_config_id
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

    -- 3. Select Eligible Rewards
    -- Create a temporary table to hold eligible rewards
    CREATE TEMP TABLE temp_eligible_rewards ON COMMIT DROP AS
    SELECT * FROM scratch_card_rewards 
    WHERE campaign_id = p_campaign_id 
    AND is_active = true
    AND (type != 'product' OR product_quantity > 0);

    -- Check if any rewards exist
    IF NOT EXISTS (SELECT 1 FROM temp_eligible_rewards) THEN
        RETURN jsonb_build_object('error', 'No rewards available', 'code', 'NO_REWARDS');
    END IF;

    -- Calculate Total Probability
    SELECT SUM(probability) INTO v_total_prob FROM temp_eligible_rewards;

    -- If total prob is 0, pick any (or fail)
    IF v_total_prob IS NULL OR v_total_prob = 0 THEN
         -- Fallback to first available
         SELECT id INTO v_selected_reward_id FROM temp_eligible_rewards LIMIT 1;
    ELSE
        -- Weighted Random Selection
        v_random_val := random() * v_total_prob;
        
        FOR v_reward IN SELECT * FROM temp_eligible_rewards LOOP
            v_cumulative_prob := v_cumulative_prob + v_reward.probability;
            IF v_random_val <= v_cumulative_prob THEN
                v_selected_reward_id := v_reward.id;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    -- If still no selection (rounding errors?), pick last
    IF v_selected_reward_id IS NULL THEN
        SELECT id INTO v_selected_reward_id FROM temp_eligible_rewards ORDER BY probability DESC LIMIT 1;
    END IF;

    -- 4. Process Selection (Decrement Stock)
    SELECT * INTO v_reward FROM scratch_card_rewards WHERE id = v_selected_reward_id;

    IF v_reward.type = 'product' THEN
        UPDATE scratch_card_rewards 
        SET product_quantity = product_quantity - 1 
        WHERE id = v_selected_reward_id AND product_quantity > 0;
        
        -- If update failed (race condition), fallback to no_prize
        IF NOT FOUND THEN
             SELECT * INTO v_reward FROM scratch_card_rewards WHERE campaign_id = p_campaign_id AND type = 'no_prize' LIMIT 1;
             IF FOUND THEN
                 v_selected_reward_id := v_reward.id;
             ELSE
                 RETURN jsonb_build_object('error', 'Reward unavailable', 'code', 'REWARD_UNAVAILABLE');
             END IF;
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
        'points_value', v_reward.value_points,
        'reward_image_url', v_reward.image_url,
        'play_id', v_play_id
    );
END;
$$;

-- Grant execute permission to authenticated users and anon (if needed for public access)
GRANT EXECUTE ON FUNCTION play_scratch_card_turn TO authenticated;
GRANT EXECUTE ON FUNCTION play_scratch_card_turn TO anon;
