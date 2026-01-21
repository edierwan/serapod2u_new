-- DIRECT FIX for SO26000005 Approval Issue
-- This script directly queries and fixes sequences for all document types

-- Step 1: Show current state of documents and sequences
DO $$
DECLARE
    v_company_id uuid;
    v_max_do integer;
    v_max_si integer;
    v_max_po integer;
    v_max_so integer;
    v_current_do integer;
    v_current_si integer;
    v_current_po integer;
    v_current_so integer;
BEGIN
    -- Get company_id (assuming single company for now - adjust if needed)
    SELECT DISTINCT company_id INTO v_company_id FROM documents LIMIT 1;
    
    RAISE NOTICE 'Company ID: %', v_company_id;
    
    -- Find max DO numbers in documents table
    SELECT MAX(SUBSTRING(display_doc_no, 5, 6)::integer) INTO v_max_do
    FROM documents WHERE display_doc_no LIKE 'DO26%' AND company_id = v_company_id;
    
    -- Find max SI (Invoice) numbers in documents table
    SELECT MAX(SUBSTRING(display_doc_no, 5, 6)::integer) INTO v_max_si
    FROM documents WHERE display_doc_no LIKE 'SI26%' AND company_id = v_company_id;
    
    -- Find max PO numbers in documents table
    SELECT MAX(SUBSTRING(display_doc_no, 5, 6)::integer) INTO v_max_po
    FROM documents WHERE display_doc_no LIKE 'PO26%' AND company_id = v_company_id;
    
    -- Find max SO numbers in orders table
    SELECT MAX(SUBSTRING(display_doc_no, 5, 6)::integer) INTO v_max_so
    FROM orders WHERE display_doc_no LIKE 'SO26%' AND company_id = v_company_id;
    
    -- Get current sequence values
    SELECT next_seq INTO v_current_do FROM doc_sequences WHERE company_id = v_company_id AND doc_type = 'DO' AND year = 2026;
    SELECT next_seq INTO v_current_si FROM doc_sequences WHERE company_id = v_company_id AND doc_type = 'SI' AND year = 2026;
    SELECT next_seq INTO v_current_po FROM doc_sequences WHERE company_id = v_company_id AND doc_type = 'PO' AND year = 2026;
    SELECT next_seq INTO v_current_so FROM doc_sequences WHERE company_id = v_company_id AND doc_type = 'SO' AND year = 2026;
    
    RAISE NOTICE '=== DIAGNOSIS ===';
    RAISE NOTICE 'DO: Max in DB = %, Current Seq = %', COALESCE(v_max_do, 0), COALESCE(v_current_do, 0);
    RAISE NOTICE 'SI: Max in DB = %, Current Seq = %', COALESCE(v_max_si, 0), COALESCE(v_current_si, 0);
    RAISE NOTICE 'PO: Max in DB = %, Current Seq = %', COALESCE(v_max_po, 0), COALESCE(v_current_po, 0);
    RAISE NOTICE 'SO: Max in DB = %, Current Seq = %', COALESCE(v_max_so, 0), COALESCE(v_current_so, 0);
    
    -- Fix DO sequence
    IF v_max_do IS NOT NULL THEN
        INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
        VALUES (v_company_id, 'DO', 2026, v_max_do + 1, NOW())
        ON CONFLICT (company_id, doc_type, year)
        DO UPDATE SET next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq), updated_at = NOW();
        RAISE NOTICE 'Fixed DO sequence to %', v_max_do + 1;
    END IF;
    
    -- Fix SI sequence
    IF v_max_si IS NOT NULL THEN
        INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
        VALUES (v_company_id, 'SI', 2026, v_max_si + 1, NOW())
        ON CONFLICT (company_id, doc_type, year)
        DO UPDATE SET next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq), updated_at = NOW();
        RAISE NOTICE 'Fixed SI sequence to %', v_max_si + 1;
    END IF;
    
    -- Fix PO sequence
    IF v_max_po IS NOT NULL THEN
        INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
        VALUES (v_company_id, 'PO', 2026, v_max_po + 1, NOW())
        ON CONFLICT (company_id, doc_type, year)
        DO UPDATE SET next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq), updated_at = NOW();
        RAISE NOTICE 'Fixed PO sequence to %', v_max_po + 1;
    END IF;
    
    -- Fix SO sequence  
    IF v_max_so IS NOT NULL THEN
        INSERT INTO doc_sequences (company_id, doc_type, year, next_seq, last_used_at)
        VALUES (v_company_id, 'SO', 2026, v_max_so + 1, NOW())
        ON CONFLICT (company_id, doc_type, year)
        DO UPDATE SET next_seq = GREATEST(doc_sequences.next_seq, EXCLUDED.next_seq), updated_at = NOW();
        RAISE NOTICE 'Fixed SO sequence to %', v_max_so + 1;
    END IF;
    
    RAISE NOTICE '=== FIX COMPLETE ===';
END $$;

-- Step 2: Show all existing display_doc_no in documents to identify duplicates
SELECT display_doc_no, COUNT(*) as cnt 
FROM documents 
WHERE display_doc_no IS NOT NULL 
GROUP BY display_doc_no 
HAVING COUNT(*) > 1;

-- Step 3: Show current sequences
SELECT * FROM doc_sequences WHERE year = 2026 ORDER BY doc_type;

-- Step 4: Show what documents exist for recent orders
SELECT d.display_doc_no, d.doc_type, d.doc_no, o.display_doc_no as order_display_no, o.order_no
FROM documents d
JOIN orders o ON d.order_id = o.id
WHERE d.created_at > NOW() - INTERVAL '7 days'
ORDER BY d.created_at DESC
LIMIT 20;
