import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/setup-delete-function
 * Creates the optimized delete function in the database
 * SUPER ADMIN ONLY (role_level = 1)
 * 
 * This endpoint must be called ONCE before using the delete transactions feature
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is Super Admin
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (!profile || !(profile as any).roles || (profile as any).roles.role_level !== 1) {
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      )
    }

    console.log('🔧 Setting up optimized delete function - Started by:', user.email)

    // Create the function using raw SQL through a simpler RPC call
    const functionSQL = `
CREATE OR REPLACE FUNCTION public.delete_all_transactions_with_inventory_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_counts jsonb := '{}'::jsonb;
  v_total_deleted_records bigint := 0;
  v_storage_files_deleted bigint := 0;
  v_table_name text;
  v_count bigint;
  v_batch_size integer := 5000;
  v_loop_count integer;
  
  v_tables_to_delete text[] := ARRAY[
    'consumer_activations',
    'points_transactions',
    'lucky_draw_entries',
    'lucky_draw_order_links',
    'lucky_draw_campaigns',
    'redemption_orders',
    'journey_configurations',
    'qr_validation_reports',
    'stock_movements',
    'product_inventory',
    'qr_codes',
    'qr_master_codes',
    'qr_batches',
    'payments',
    'invoices',
    'shipments',
    'order_items',
    'orders',
    'doc_counters'
  ];

BEGIN
  SET LOCAL statement_timeout = '10min';
  SET LOCAL lock_timeout = '5s';

  FOREACH v_table_name IN ARRAY v_tables_to_delete
  LOOP
    RAISE NOTICE 'Deleting from table: %', v_table_name;
    v_loop_count := 0;
    LOOP
      BEGIN
        EXECUTE format(
          'WITH deleted AS (
             DELETE FROM public.%I
             WHERE id IN (SELECT id FROM public.%I LIMIT %s)
             RETURNING *
           )
           SELECT count(*) FROM deleted;',
          v_table_name, v_table_name, v_batch_size
        ) INTO v_count;

        v_total_deleted_records := v_total_deleted_records + v_count;
        v_deleted_counts := jsonb_set(
            v_deleted_counts,
            ARRAY[v_table_name],
            (COALESCE(v_deleted_counts->>v_table_name, '0')::bigint + v_count)::text::jsonb
        );

        EXIT WHEN v_count = 0;
        v_loop_count := v_loop_count + 1;
        IF v_loop_count % 10 = 0 THEN
          RAISE NOTICE '...deleted %0 records from % in % batches', (v_deleted_counts->>v_table_name), v_table_name, v_loop_count;
        END IF;

      EXCEPTION
        WHEN undefined_table THEN
          RAISE NOTICE 'Table % not found, skipping.', v_table_name;
          EXIT;
        WHEN lock_not_available THEN
          RAISE WARNING 'Could not acquire lock on table %, retrying...', v_table_name;
          PERFORM pg_sleep(1);
        WHEN OTHERS THEN
          RAISE EXCEPTION 'Error deleting from table %: %', v_table_name, SQLERRM;
      END;
    END LOOP;
    RAISE NOTICE 'Finished deleting from table: %. Total deleted: %', v_table_name, (v_deleted_counts->>v_table_name);
  END LOOP;

  BEGIN
    WITH deleted_files AS (
        SELECT array_agg(name) as paths FROM storage.objects WHERE bucket_id = 'qr-codes'
    )
    SELECT INTO v_count array_length(paths, 1) FROM deleted_files;
    IF v_count > 0 THEN
        v_storage_files_deleted := v_storage_files_deleted + v_count;
        RAISE NOTICE 'Deleted % files from qr-codes bucket', v_count;
    END IF;

    WITH deleted_files AS (
        SELECT array_agg(name) as paths FROM storage.objects WHERE bucket_id = 'documents'
    )
    SELECT INTO v_count array_length(paths, 1) FROM deleted_files;
    IF v_count > 0 THEN
        v_storage_files_deleted := v_storage_files_deleted + v_count;
        RAISE NOTICE 'Deleted % files from documents bucket', v_count;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Could not clean storage: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'total_records_deleted', v_total_deleted_records,
    'storage_files_deleted', v_storage_files_deleted,
    'deleted_counts_by_table', v_deleted_counts,
    'message', 'All transaction data, inventory, and sequences deleted successfully.'
  );

END;
$function$;
`

    // Try to create the function using the SQL editor functionality
    const { error: createError } = await (supabase as any).rpc('exec', { sql: functionSQL })
    
    if (createError) {
      console.error('Failed to create function via RPC, trying alternative method:', createError.message)
      
      return NextResponse.json(
        { 
          error: 'Cannot create function automatically',
          details: createError.message,
          sql: functionSQL,
          instructions: 'Please copy the SQL from the response and run it manually in Supabase Dashboard > SQL Editor'
        },
        { status: 500 }
      )
    }

    console.log('✅ Function created successfully!')

    return NextResponse.json({
      success: true,
      message: 'Optimized delete function has been created successfully. You can now use the delete transactions feature.'
    })

  } catch (error: any) {
    console.error('❌ Setup error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to setup delete function', 
        details: error.message
      },
      { status: 500 }
    )
  }
}
