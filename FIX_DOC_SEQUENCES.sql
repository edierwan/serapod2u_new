-- Fix sequence out-of-sync issues for ALL documents and orders
-- This script scans the actual tables to find the true maximum used numbers 
-- and ensures the doc_sequences table is initialized correctly to avoid collisions.

DO $$
DECLARE
    r RECORD;
    v_year integer := 2026;
    v_year_short text := '26';
    v_seq integer;
    v_updated_count integer := 0;
    v_inserted_count integer := 0;
BEGIN
    RAISE NOTICE 'Starting comprehensive sequence repair for year %...', v_year;

    -- =========================================================================
    -- 1. Scan DOCUMENTS table for all prefixes in use
    -- =========================================================================
    FOR r IN 
        SELECT 
            company_id, 
            SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short) as prefix,
            MAX(SUBSTRING(display_doc_no FROM LENGTH(SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short)) + 3 FOR 6)::integer) as max_seq
        FROM documents 
        WHERE display_doc_no ~ ('^[A-Z]+' || v_year_short || '\d{6}$')
        GROUP BY company_id, SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short)
    LOOP
        IF r.prefix IS NOT NULL AND r.max_seq IS NOT NULL THEN
            -- Check if sequence exists
            IF EXISTS (SELECT 1 FROM doc_sequences WHERE company_id = r.company_id AND doc_type = r.prefix AND year = v_year) THEN
                -- Update existing
                UPDATE doc_sequences
                SET next_seq = GREATEST(next_seq, r.max_seq + 1),
                    last_used_at = NOW(),
                    updated_at = NOW()
                WHERE company_id = r.company_id AND doc_type = r.prefix AND year = v_year 
                AND next_seq <= r.max_seq; -- Only update if lag detected
                
                IF FOUND THEN
                    v_updated_count := v_updated_count + 1;
                    RAISE NOTICE 'Updated sequence for Company % Prefix % to % (found max % in documents)', r.company_id, r.prefix, r.max_seq + 1, r.max_seq;
                END IF;
            ELSE
                -- Insert missing sequence
                INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
                VALUES (r.company_id, r.prefix, v_year, r.max_seq + 1, NOW());
                
                v_inserted_count := v_inserted_count + 1;
                RAISE NOTICE 'Initialized sequence for Company % Prefix % to % (found max % in documents)', r.company_id, r.prefix, r.max_seq + 1, r.max_seq;
            END IF;
        END IF;
    END LOOP;

    -- =========================================================================
    -- 2. Scan ORDERS table for all prefixes in use
    -- =========================================================================
    FOR r IN 
        SELECT 
            company_id, 
            SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short) as prefix,
            MAX(SUBSTRING(display_doc_no FROM LENGTH(SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short)) + 3 FOR 6)::integer) as max_seq
        FROM orders 
        WHERE display_doc_no ~ ('^[A-Z]+' || v_year_short || '\d{6}$')
        GROUP BY company_id, SUBSTRING(display_doc_no FROM '^([A-Z]+)' || v_year_short)
    LOOP
        IF r.prefix IS NOT NULL AND r.max_seq IS NOT NULL THEN
            -- Check if sequence exists
            IF EXISTS (SELECT 1 FROM doc_sequences WHERE company_id = r.company_id AND doc_type = r.prefix AND year = v_year) THEN
                -- Update existing
                UPDATE doc_sequences
                SET next_seq = GREATEST(next_seq, r.max_seq + 1),
                    last_used_at = NOW(),
                    updated_at = NOW()
                WHERE company_id = r.company_id AND doc_type = r.prefix AND year = v_year 
                AND next_seq <= r.max_seq;
                
                IF FOUND THEN
                    v_updated_count := v_updated_count + 1;
                    RAISE NOTICE 'Updated sequence for Company % Prefix % to % (found max % in orders)', r.company_id, r.prefix, r.max_seq + 1, r.max_seq;
                END IF;
            ELSE
                -- Insert missing sequence
                INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
                VALUES (r.company_id, r.prefix, v_year, r.max_seq + 1, NOW());
                
                v_inserted_count := v_inserted_count + 1;
                RAISE NOTICE 'Initialized sequence for Company % Prefix % to % (found max % in orders)', r.company_id, r.prefix, r.max_seq + 1, r.max_seq;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Repair completed. Updated % sequences, Initialized % new sequences.', v_updated_count, v_inserted_count;
END $$;
