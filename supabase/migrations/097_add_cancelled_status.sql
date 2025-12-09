-- Migration: Add 'cancelled' to order_status enum
-- Description: Allow orders to be cancelled without deletion.

-- This must be run outside of a transaction block usually, but Supabase SQL editor handles it.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cancelled';
