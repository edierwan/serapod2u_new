-- Migration: 059_delete_scratch_campaign_rpc.sql
-- Description: RPC to delete a scratch card campaign and return unused stock

CREATE OR REPLACE FUNCTION public.delete_scratch_campaign(p_campaign_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign record;
    v_reward record;
    v_allocated_qty integer;
    v_won_qty integer;
    v_return_qty integer;
    v_inventory_id uuid;
    v_current_qty integer;
    v_new_qty integer;
    v_org_id uuid;
    v_company_id uuid;
BEGIN
    -- 1. Get campaign details
    SELECT * INTO v_campaign FROM public.scratch_card_campaigns WHERE id = p_campaign_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found';
    END IF;

    v_org_id := v_campaign.org_id;
    SELECT get_company_id(v_org_id) INTO v_company_id;

    -- 2. Disable scratch card feature in journey configuration if linked
    IF v_campaign.journey_config_id IS NOT NULL THEN
        UPDATE public.journey_configurations
        SET enable_scratch_card_game = false,
            updated_at = now()
        WHERE id = v_campaign.journey_config_id;
    END IF;

    -- 3. Process product rewards to return stock
    FOR v_reward IN 
        SELECT * FROM public.scratch_card_rewards 
        WHERE campaign_id = p_campaign_id 
        AND type = 'product' 
        AND variant_id IS NOT NULL
    LOOP
        -- Calculate allocated quantity (from rewards table)
        -- Note: The rewards table stores 'product_quantity' which is per win, but we need total allocated.
        -- Wait, the allocation logic in the form uses 'record_stock_movement' directly.
        -- We need to find how much was allocated by summing up 'scratch_game_out' movements for this campaign.
        
        -- Calculate total allocated (sum of negative movements)
        SELECT COALESCE(ABS(SUM(quantity_change)), 0) INTO v_allocated_qty
        FROM public.stock_movements
        WHERE reference_type = 'campaign'
          AND reference_id = p_campaign_id
          AND variant_id = v_reward.variant_id
          AND movement_type = 'scratch_game_out';

        -- Calculate total won (count of wins * quantity per win)
        SELECT COALESCE(COUNT(*), 0) * v_reward.product_quantity INTO v_won_qty
        FROM public.scratch_card_plays
        WHERE campaign_id = p_campaign_id
          AND reward_id = v_reward.id
          AND is_win = true;

        v_return_qty := v_allocated_qty - v_won_qty;

        -- If there is stock to return
        IF v_return_qty > 0 THEN
            -- Find best inventory to return to (same logic as in form: prefer user org or max stock)
            -- For simplicity in RPC, we return to the organization that originally issued the stock if possible,
            -- but stock movements might be split across orgs.
            -- Let's find the most recent 'scratch_game_out' movement for this variant/campaign to get the source org.
            
            SELECT from_organization_id INTO v_org_id
            FROM public.stock_movements
            WHERE reference_type = 'campaign'
              AND reference_id = p_campaign_id
              AND variant_id = v_reward.variant_id
              AND movement_type = 'scratch_game_out'
            ORDER BY created_at DESC
            LIMIT 1;
            
            -- If not found (maybe manual allocation?), default to campaign org
            IF v_org_id IS NULL THEN
                v_org_id := v_campaign.org_id;
            END IF;

            -- Record stock movement (SG+)
            PERFORM public.record_stock_movement(
                p_movement_type := 'scratch_game_in',
                p_variant_id := v_reward.variant_id,
                p_organization_id := v_org_id,
                p_quantity_change := v_return_qty,
                p_unit_cost := 0,
                p_reason := 'Campaign Deleted: ' || v_campaign.name,
                p_reference_type := 'campaign',
                p_reference_id := p_campaign_id,
                p_created_by := p_user_id
            );
        END IF;
    END LOOP;

    -- 4. Delete campaign (and cascade delete rewards/plays if configured, otherwise manual delete)
    -- Assuming cascade delete is set up on foreign keys, otherwise we delete manually
    DELETE FROM public.scratch_card_rewards WHERE campaign_id = p_campaign_id;
    DELETE FROM public.scratch_card_plays WHERE campaign_id = p_campaign_id;
    DELETE FROM public.scratch_card_campaigns WHERE id = p_campaign_id;

END;
$$;
