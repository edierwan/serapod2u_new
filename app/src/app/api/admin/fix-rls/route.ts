import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Temporary endpoint to fix RLS policy - REMOVE AFTER USE
export async function POST() {
  try {
    // Use service role key to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Drop old policy
    const dropPolicy = `
      DROP POLICY IF EXISTS orders_select ON orders;
    `

    // Create new policy with warehouse_org_id
    const createPolicy = `
      CREATE POLICY orders_select ON orders 
        FOR SELECT 
        TO authenticated 
        USING (
          (buyer_org_id = public.current_user_org_id()) 
          OR (seller_org_id = public.current_user_org_id())
          OR (warehouse_org_id = public.current_user_org_id())
          OR (
            (public.get_org_type(public.current_user_org_id()) = 'HQ'::text) 
            AND public.is_power_user() 
            AND (company_id = public.get_company_id(public.current_user_org_id()))
          )
        );
    `

    const result1 = await supabase.rpc('exec_raw_sql', { query: dropPolicy })
    const result2 = await supabase.rpc('exec_raw_sql', { query: createPolicy })

    return NextResponse.json({
      message: 'RLS policy fix applied',
      dropResult: result1,
      createResult: result2
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
