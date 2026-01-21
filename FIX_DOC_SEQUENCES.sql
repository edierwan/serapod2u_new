-- Fix sequence out-of-sync issues for BOTH orders and documents tables
-- This ensures that the doc_sequences table reflects the true maximum used number across the system

DO $$
DECLARE
    r RECORD;
    v_cursor REFCURSOR;
    v_year integer := 2026;
    v_year_short text := '26';
    v_prefix text;
    v_max_seq_orders integer := 0;
    v_max_seq_docs integer := 0;
    v_true_max_seq integer := 0;
    v_current_next_seq integer;
    v_updated_count integer := 0;
BEGIN
    RAISE NOTICE 'Starting full sequence repair for year %...', v_year;

    -- Iterate over each company and doc_type currently tracked in doc_sequences
    -- We basically iterate all possible prefixes detected in the sequence table to be safe
    -- Or better, we define the known prefixes we care about
    
    FOR r IN 
        SELECT DISTINCT company_id, doc_type
        FROM doc_sequences
        WHERE year = v_year
    LOOP
        v_prefix := r.doc_type;
        
        -- 1. Check MAX in ORDERS table (Only relevant for SO/ORD typically, but good to check all)
        SELECT MAX(SUBSTRING(display_doc_no FROM LENGTH(v_prefix) + 3 FOR 6)::integer)
        INTO v_max_seq_orders
        FROM orders
        WHERE company_id = r.company_id
        AND display_doc_no LIKE v_prefix || v_year_short || '%'
        AND display_doc_no ~ ('^' || v_prefix || v_year_short || '\d{6}$');
        
        -- 2. Check MAX in DOCUMENTS table (Relevant for PO, INV, DO, etc, and also SO if stored there)
        SELECT MAX(SUBSTRING(display_doc_no FROM LENGTH(v_prefix) + 3 FOR 6)::integer)
        INTO v_max_seq_docs
        FROM documents
        WHERE company_id = r.company_id
        AND display_doc_no LIKE v_prefix || v_year_short || '%'
        AND display_doc_no ~ ('^' || v_prefix || v_year_short || '\d{6}$');
        
        -- 3. Determine True Max
        v_true_max_seq := GREATEST(COALESCE(v_max_seq_orders, 0), COALESCE(v_max_seq_docs, 0));
        
        IF v_true_max_seq > 0 THEN
            -- Get current sequence value
            SELECT next_seq INTO v_current_next_seq
            FROM doc_sequences
            WHERE company_id = r.company_id AND doc_type = r.doc_type AND year = v_year;
            
            -- Update if lag detected
            -- If max used is 5, next should be 6. 
            -- If current next is 5, it will generate 5 -> Collision!
            -- So we update if next_seq <= max_used
            
            IF v_current_next_seq <= v_true_max_seq THEN
                UPDATE doc_sequences
                SET next_seq = v_true_max_seq + 1,
                    last_used_at = NOW(),
                    updated_at = NOW()
                WHERE company_id = r.company_id 
                AND doc_type = r.doc_type 
                AND year = v_year;
                
                v_updated_count := v_updated_count + 1;
                RAISE NOTICE 'FIXED: Company % Type %: Max used %, Sequence bumped to %', r.company_id, v_prefix, v_true_max_seq, v_true_max_seq + 1;
            ELSE
                RAISE NOTICE 'OK: Company % Type %: Max used %, Sequence is %', r.company_id, v_prefix, v_true_max_seq, v_current_next_seq;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Repair completed. Updated % sequences.', v_updated_count;
END $$;
