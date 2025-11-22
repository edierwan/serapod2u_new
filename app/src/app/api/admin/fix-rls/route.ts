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

    // Drop old restrictive policy
    const dropPolicy = `
      DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;
    `

    // Create new policy that allows shops to view their own scans
    const createPolicy = `
      CREATE POLICY "Users and shops can view relevant scans"
        ON consumer_qr_scans
        FOR SELECT
        TO authenticated
        USING (
          consumer_id = auth.uid()
          OR
          EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.organization_id = consumer_qr_scans.shop_id
          )
          OR
          EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.role_code IN ('SA', 'HQ', 'POWER_USER')
          )
        );
    `

    console.log('🔧 Dropping old policy...')
    const result1 = await supabase.rpc('exec_raw_sql', { query: dropPolicy })
    console.log('✅ Drop result:', result1)
    
    console.log('🔧 Creating new policy...')
    const result2 = await supabase.rpc('exec_raw_sql', { query: createPolicy })
    console.log('✅ Create result:', result2)

    return NextResponse.json({
      message: 'Shop RLS policy fix applied - shops can now view their own point balance',
      dropResult: result1,
      createResult: result2
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
