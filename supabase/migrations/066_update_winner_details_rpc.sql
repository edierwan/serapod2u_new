-- Migration: 066_update_winner_details_rpc.sql

CREATE OR REPLACE FUNCTION update_scratch_winner_details(
    p_play_id UUID,
    p_name TEXT,
    p_phone TEXT,
    p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_play RECORD;
BEGIN
    SELECT * INTO v_play FROM scratch_card_plays WHERE id = p_play_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Play record not found', 'code', 'NOT_FOUND');
    END IF;

    IF v_play.is_win IS NOT TRUE THEN
        RETURN jsonb_build_object('error', 'Not a winning play', 'code', 'NOT_WINNER');
    END IF;

    UPDATE scratch_card_plays
    SET 
        consumer_name = p_name,
        consumer_phone = p_phone,
        consumer_email = p_email,
        winner_details_submitted_at = NOW()
    WHERE id = p_play_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
