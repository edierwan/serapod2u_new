-- Fix sequence out-of-sync issues for new document numbering system
-- Run this script to repair "duplicate key value violates unique constraint" errors

DO $$
DECLARE
    r RECORD;
    v_year integer;
    v_prefix text;
    v_seq_part integer;
    v_max_seq integer;
    v_new_seq integer;
    v_updated_count integer := 0;
BEGIN
    v_year := 2026; -- Target year
    RAISE NOTICE 'Starting sequence repair for year %...', v_year;

    -- 1. Identify all prefixes used in ORDERS table for the current year
    FOR r IN 
        SELECT DISTINCT company_id, 
               SUBSTRING(display_doc_no FROM '^[A-Za-z]+') as prefix
        FROM orders 
        WHERE display_doc_no IS NOT NULL 
        AND display_doc_no LIKE '%26%' -- Ensure it contains year 26
        AND display_doc_no ~ '^[A-Za-z]+26\d{6}' -- Regex to match PREFIX + 26 + 6 digits
    LOOP
        v_prefix := r.prefix;
        
        -- Find max sequence for this company/prefix
        -- We extract exactly 6 digits after the prefix + 2 digits (year)
        -- This handles suffixes like -01 safely
        SELECT MAX(SUBSTRING(display_doc_no FROM LENGTH(v_prefix) + 3 FOR 6)::integer)
        INTO v_max_seq
        FROM orders
        WHERE company_id = r.company_id
        AND display_doc_no LIKE v_prefix || (v_year % 100)::text || '%';
        
        IF v_max_seq IS NOT NULL THEN
            -- Check/Update doc_sequences
            INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
            VALUES (r.company_id, v_prefix, v_year, v_max_seq + 1, NOW())
            ON CONFLICT (company_id, doc_type, year)
            DO UPDATE SET
                next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq);
                
            -- Check if we updated/inserted
            IF found THEN
                v_updated_count := v_updated_count + 1;
                RAISE NOTICE 'Synced sequence for Company % Prefix %: Max found %, Next Seq set to %', r.company_id, v_prefix, v_max_seq, v_max_seq + 1;
            END IF;
        END IF;
    END LOOP;

    -- 2. Identify all prefixes used in DOCUMENTS table for the current year
    FOR r IN 
        SELECT DISTINCT company_id, 
               SUBSTRING(display_doc_no FROM '^[A-Za-z]+') as prefix
        FROM documents
        WHERE display_doc_no IS NOT NULL 
        AND display_doc_no LIKE '%26%'
        AND display_doc_no ~ '^[A-Za-z]+26\d{6}'
    LOOP
        v_prefix := r.prefix;
        
        -- Find max sequence for this company/prefix
        SELECT MAX(SUBSTRING(display_doc_no FROM LENGTH(v_prefix) + 3 FOR 6)::integer)
        INTO v_max_seq
        FROM documents
        WHERE company_id = r.company_id
        AND display_doc_no LIKE v_prefix || (v_year % 100)::text || '%';
        
        IF v_max_seq IS NOT NULL THEN
            -- Check/Update doc_sequences
            INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
            VALUES (r.company_id, v_prefix, v_year, v_max_seq + 1, NOW())
            ON CONFLICT (company_id, doc_type, year)
            DO UPDATE SET
                next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq);

             IF found THEN
                v_updated_count := v_updated_count + 1;
                 RAISE NOTICE 'Synced sequence for Company % Prefix % [Docs]: Max found %, Next Seq set to %', r.company_id, v_prefix, v_max_seq, v_max_seq + 1;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Fixed sequences for % prefixes.', v_updated_count;
END $$;
