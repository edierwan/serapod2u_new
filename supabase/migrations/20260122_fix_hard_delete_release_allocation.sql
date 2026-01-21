-- ==========================================
-- Fix: Release allocation when hard deleting order
-- ==========================================
-- Issue: When an SO (Sales Order) is deleted, the allocated stock 
-- in product_inventory is not released, causing incorrect Available quantities
-- 
-- Solution: Call release_allocation_for_order BEFORE deleting the order
-- ==========================================

-- Drop and recreate the function with allocation release
DROP FUNCTION IF EXISTS public.hard_delete_order(UUID);

CREATE OR REPLACE FUNCTION public.hard_delete_order(p_order_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- This bypasses RLS
SET search_path = public
SET statement_timeout = '300s'  -- Allow 5 minutes for large deletions
AS $$
DECLARE
    v_order_no TEXT;
    v_display_doc_no TEXT;
    v_company_id UUID;
    v_order_type TEXT;
    v_order_status TEXT;
    v_qr_codes_deleted INTEGER := 0;
    v_qr_batches_deleted INTEGER := 0;
    v_qr_master_codes_deleted INTEGER := 0;
    v_documents_deleted INTEGER := 0;
    v_order_items_deleted INTEGER := 0;
    v_stock_movements_deleted INTEGER := 0;
    v_lucky_draw_entries_deleted INTEGER := 0;
    v_scratch_card_plays_deleted INTEGER := 0;
    v_consumer_qr_scans_deleted INTEGER := 0;
    v_document_files_deleted INTEGER := 0;
    v_consumer_activations_deleted INTEGER := 0;
    v_daily_quiz_plays_deleted INTEGER := 0;
    v_points_transactions_deleted INTEGER := 0;
    v_qr_movements_deleted INTEGER := 0;
    v_consumer_feedback_deleted INTEGER := 0;
    v_allocation_released BOOLEAN := false;
    v_batch_size INTEGER := 10000;
    v_deleted_count INTEGER;
BEGIN
    -- Get order details
    SELECT order_no, display_doc_no, company_id, order_type, status 
    INTO v_order_no, v_display_doc_no, v_company_id, v_order_type, v_order_status
    FROM orders WHERE id = p_order_id;
    
    IF v_order_no IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Order not found'
        );
    END IF;

    RAISE NOTICE 'Starting hard delete for order % (%) - Type: %, Status: %', 
        v_order_no, p_order_id, v_order_type, v_order_status;

    -- =====================================================
    -- STEP 0: RELEASE ALLOCATION BEFORE DELETION
    -- This is critical for D2H and S2D orders that allocate inventory
    -- Must be done BEFORE deleting order_items since release function needs them
    -- =====================================================
    IF v_order_type IN ('D2H', 'S2D') AND v_order_status NOT IN ('completed', 'shipped') THEN
        BEGIN
            RAISE NOTICE 'Releasing allocation for order %...', v_order_no;
            PERFORM public.release_allocation_for_order(p_order_id);
            v_allocation_released := true;
            RAISE NOTICE 'Allocation released successfully for order %', v_order_no;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to release allocation for order %: %', v_order_no, SQLERRM;
            -- Continue with deletion even if allocation release fails
            -- The stock_movements deletion will handle the records
        END;
    END IF;

    -- Note: We use batch deletion to avoid timeouts
    -- Triggers remain active but batching prevents long-running transactions

    -- 1. Delete scratch_card_plays (references qr_codes) - in batches
    LOOP
        DELETE FROM scratch_card_plays 
        WHERE id IN (
            SELECT sp.id FROM scratch_card_plays sp
            INNER JOIN qr_codes qc ON sp.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_scratch_card_plays_deleted := v_scratch_card_plays_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 2. Delete consumer_qr_scans (references qr_codes) - in batches
    LOOP
        DELETE FROM consumer_qr_scans 
        WHERE id IN (
            SELECT cqs.id FROM consumer_qr_scans cqs
            INNER JOIN qr_codes qc ON cqs.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_consumer_qr_scans_deleted := v_consumer_qr_scans_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 3. Delete consumer_activations (references qr_codes) - in batches
    LOOP
        DELETE FROM consumer_activations 
        WHERE id IN (
            SELECT ca.id FROM consumer_activations ca
            INNER JOIN qr_codes qc ON ca.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_consumer_activations_deleted := v_consumer_activations_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 4. Delete daily_quiz_plays (references qr_codes) - in batches
    LOOP
        DELETE FROM daily_quiz_plays 
        WHERE id IN (
            SELECT dqp.id FROM daily_quiz_plays dqp
            INNER JOIN qr_codes qc ON dqp.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_daily_quiz_plays_deleted := v_daily_quiz_plays_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 5. Delete points_transactions (references qr_codes) - in batches
    LOOP
        DELETE FROM points_transactions 
        WHERE id IN (
            SELECT pt.id FROM points_transactions pt
            INNER JOIN qr_codes qc ON pt.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_points_transactions_deleted := v_points_transactions_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 5b. Delete lucky_draw_entries by order_id directly (not just via qr_codes)
    LOOP
        DELETE FROM lucky_draw_entries 
        WHERE id IN (
            SELECT id FROM lucky_draw_entries WHERE order_id = p_order_id LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_lucky_draw_entries_deleted := v_lucky_draw_entries_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- Also delete lucky_draw_entries via qr_codes
    LOOP
        DELETE FROM lucky_draw_entries 
        WHERE id IN (
            SELECT lde.id FROM lucky_draw_entries lde
            INNER JOIN qr_codes qc ON lde.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_lucky_draw_entries_deleted := v_lucky_draw_entries_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 6. Delete qr_movements (references qr_codes)
    LOOP
        DELETE FROM qr_movements 
        WHERE id IN (
            SELECT qm.id FROM qr_movements qm
            INNER JOIN qr_codes qc ON qm.qr_code_id = qc.id
            WHERE qc.order_id = p_order_id
            LIMIT v_batch_size
        );
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_qr_movements_deleted := v_qr_movements_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 7. Update consumer_feedback to SET NULL (it has ON DELETE SET NULL)
    UPDATE consumer_feedback SET qr_code_id = NULL
    WHERE qr_code_id IN (SELECT id FROM qr_codes WHERE order_id = p_order_id);
    GET DIAGNOSTICS v_consumer_feedback_deleted = ROW_COUNT;

    -- 8. Delete qr_codes - in batches
    LOOP
        DELETE FROM qr_codes 
        WHERE id IN (SELECT id FROM qr_codes WHERE order_id = p_order_id LIMIT v_batch_size);
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_qr_codes_deleted := v_qr_codes_deleted + v_deleted_count;
        EXIT WHEN v_deleted_count = 0;
    END LOOP;

    -- 9. Delete qr_master_codes and qr_batches
    DELETE FROM qr_master_codes 
    WHERE batch_id IN (SELECT id FROM qr_batches WHERE order_id = p_order_id);
    GET DIAGNOSTICS v_qr_master_codes_deleted = ROW_COUNT;

    DELETE FROM qr_batches WHERE order_id = p_order_id;
    GET DIAGNOSTICS v_qr_batches_deleted = ROW_COUNT;

    -- 10. Delete document_files and documents
    DELETE FROM document_files 
    WHERE document_id IN (SELECT id FROM documents WHERE order_id = p_order_id);
    GET DIAGNOSTICS v_document_files_deleted = ROW_COUNT;

    DELETE FROM documents WHERE order_id = p_order_id;
    GET DIAGNOSTICS v_documents_deleted = ROW_COUNT;

    -- 11. Delete stock_movements (by reference_id and reference_no)
    DELETE FROM stock_movements WHERE reference_id = p_order_id;
    GET DIAGNOSTICS v_stock_movements_deleted = ROW_COUNT;
    
    DELETE FROM stock_movements WHERE reference_no = v_order_no;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    v_stock_movements_deleted := v_stock_movements_deleted + v_deleted_count;

    -- Also delete by display_doc_no if different from order_no
    IF v_display_doc_no IS NOT NULL AND v_display_doc_no <> v_order_no THEN
        DELETE FROM stock_movements WHERE reference_no = v_display_doc_no;
        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
        v_stock_movements_deleted := v_stock_movements_deleted + v_deleted_count;
    END IF;

    -- 12. Delete order_items
    DELETE FROM order_items WHERE order_id = p_order_id;
    GET DIAGNOSTICS v_order_items_deleted = ROW_COUNT;

    -- 13. Delete order_doc_sequences for this order
    DELETE FROM order_doc_sequences WHERE order_id = p_order_id;

    -- 14. Finally, delete the order
    DELETE FROM orders WHERE id = p_order_id;

    RAISE NOTICE 'Hard delete completed for order %', v_order_no;

    RETURN jsonb_build_object(
        'success', true,
        'order_no', v_order_no,
        'display_doc_no_deleted', v_display_doc_no,
        'allocation_released', v_allocation_released,
        'deleted', jsonb_build_object(
            'qr_codes', v_qr_codes_deleted,
            'qr_batches', v_qr_batches_deleted,
            'qr_master_codes', v_qr_master_codes_deleted,
            'documents', v_documents_deleted,
            'document_files', v_document_files_deleted,
            'order_items', v_order_items_deleted,
            'stock_movements', v_stock_movements_deleted,
            'lucky_draw_entries', v_lucky_draw_entries_deleted,
            'scratch_card_plays', v_scratch_card_plays_deleted,
            'consumer_qr_scans', v_consumer_qr_scans_deleted,
            'consumer_activations', v_consumer_activations_deleted,
            'daily_quiz_plays', v_daily_quiz_plays_deleted,
            'points_transactions', v_points_transactions_deleted,
            'qr_movements', v_qr_movements_deleted,
            'consumer_feedback_nullified', v_consumer_feedback_deleted
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error deleting order %: %', p_order_id, SQLERRM;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.hard_delete_order(UUID) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION public.hard_delete_order(UUID) IS 
'Hard delete an order and all related data. Releases stock allocation for D2H/S2D orders before deletion.';
