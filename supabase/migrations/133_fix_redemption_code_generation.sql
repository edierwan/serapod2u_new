-- Migration: 133_fix_redemption_code_generation.sql
-- Add trigger to automatically generate redemption codes for new redemptions

-- Create trigger function to generate redemption code
CREATE OR REPLACE FUNCTION public.generate_redemption_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only generate code for redemption transactions if not already set
    IF NEW.transaction_type = 'redeem' AND (NEW.redemption_code IS NULL OR NEW.redemption_code = '') THEN
        NEW.redemption_code := 'RED-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT FROM 1 FOR 8));
    END IF;
    
    -- Set default fulfillment_status if not set for redemptions
    IF NEW.transaction_type = 'redeem' AND NEW.fulfillment_status IS NULL THEN
        NEW.fulfillment_status := 'pending';
    END IF;
    
    RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS tr_generate_redemption_code ON public.points_transactions;

-- Create trigger
CREATE TRIGGER tr_generate_redemption_code
    BEFORE INSERT ON public.points_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_redemption_code();

-- Update any existing records that don't have redemption codes
UPDATE public.points_transactions
SET redemption_code = 'RED-' || UPPER(SUBSTRING(id::TEXT FROM 1 FOR 8))
WHERE transaction_type = 'redeem' 
AND (redemption_code IS NULL OR redemption_code = '');

-- Ensure fulfillment_status is set for existing records
UPDATE public.points_transactions
SET fulfillment_status = 'pending'
WHERE transaction_type = 'redeem' 
AND fulfillment_status IS NULL;

COMMENT ON FUNCTION public.generate_redemption_code IS 'Automatically generates redemption codes and sets default fulfillment status for redemption transactions';
