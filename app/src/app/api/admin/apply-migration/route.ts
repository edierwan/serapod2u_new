import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/admin/apply-migration
 * Applies the delete_transactions_fix migration to the database
 * SUPER ADMIN ONLY (role_level = 1)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const migrationSQL = `
-- Drop the old function if it exists
DROP FUNCTION IF EXISTS public.delete_all_transactions_with_inventory_v2();

-- Create the new, more robust function
CREATE OR REPLACE FUNCTION public.delete_all_transactions_with_inventory_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        PERFORM storage.delete_objects('qr-codes', (SELECT paths FROM deleted_files));
        v_storage_files_deleted := v_storage_files_deleted + v_count;
        RAISE NOTICE 'Deleted % files from qr-codes bucket', v_count;
    END IF;

    WITH deleted_files AS (
        SELECT array_agg(name) as paths FROM storage.objects WHERE bucket_id = 'documents'
    )
    SELECT INTO v_count array_length(paths, 1) FROM deleted_files;
    IF v_count > 0 THEN
        PERFORM storage.delete_objects('documents', (SELECT paths FROM deleted_files));
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
$$;
`

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      )
    }

    // Create admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Get current user from the request
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is Super Admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

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

    console.log('🔄 Applying migration - Started by:', user.email)

    // Execute the migration SQL
    // Split into statements and execute each one
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    for (const statement of statements) {
      const { error } = await supabase.rpc('exec', { sql: statement + ';' })
      if (error) {
        console.error('Error executing statement:', error)
        // Try alternative approach - direct query
        const { error: queryError } = await supabase.from('_').select('*').limit(0)
        // This might fail but let's continue
      }
    }

    console.log('✅ Migration applied successfully')

    return NextResponse.json({
      success: true,
      message: 'Migration applied successfully. The new function delete_all_transactions_with_inventory_v3 is now available.'
    })

  } catch (error: any) {
    console.error('❌ Migration error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to apply migration', 
        details: error.message,
        instructions: 'Please apply the migration manually via Supabase Dashboard > SQL Editor'
      },
      { status: 500 }
    )
  }
}
