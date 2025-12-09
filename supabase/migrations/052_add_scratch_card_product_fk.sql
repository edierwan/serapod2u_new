-- Migration: 052_add_scratch_card_product_fk.sql
-- Description: Add foreign key constraint for product_id in scratch_card_rewards table

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'scratch_card_rewards_product_id_fkey' 
        AND table_name = 'scratch_card_rewards'
    ) THEN
        ALTER TABLE scratch_card_rewards
        ADD CONSTRAINT scratch_card_rewards_product_id_fkey
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE SET NULL;
    END IF;
END $$;
