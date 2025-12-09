-- Fix D2H order sequence
-- 1. Rename ORD-DH-1225-03 to ORD-DH-1225-01
UPDATE public.orders
SET order_no = 'ORD-DH-1225-01'
WHERE order_no = 'ORD-DH-1225-03';

-- 2. Reset counter for ORD-DH-1225 to 1
UPDATE public.doc_counters
SET next_seq = 1
WHERE scope_code = 'ORD-DH-1225';
