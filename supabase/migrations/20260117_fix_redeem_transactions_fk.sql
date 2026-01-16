-- Fix FK for redeem_gift_transactions to point to public.users to enable PostgREST joins
-- This allows the frontend to fetch user details (name, phone) when querying transactions

DO $$ 
BEGIN
    -- First try to drop the constraint if it exists (to start clean or replace)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redeem_gift_transactions_user_profile_fkey') THEN
        ALTER TABLE public.redeem_gift_transactions DROP CONSTRAINT redeem_gift_transactions_user_profile_fkey;
    END IF;

    -- Add the constraint
    ALTER TABLE public.redeem_gift_transactions
    ADD CONSTRAINT redeem_gift_transactions_user_profile_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id);

EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Error adding constraint: %', SQLERRM;
END $$;
