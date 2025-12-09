-- Migration: 055_add_variant_id_to_rewards.sql
-- Description: Add variant_id to scratch_card_rewards to support specific inventory item rewards

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'scratch_card_rewards' 
        AND column_name = 'variant_id'
    ) THEN
        ALTER TABLE scratch_card_rewards
        ADD COLUMN variant_id UUID REFERENCES product_variants(id);
    END IF;
END $$;
