import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Apply RLS policy fix to allow shops to view their own QR scans
 * This fixes the issue where shops can't see their point balance
 */
export async function POST() {
  try {
    // Use service role key to bypass RLS and execute admin commands
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

    console.log('🔧 Starting RLS policy migration...')

    // Step 1: Drop old restrictive policies
    const { data: dropData1, error: dropError1 } = await supabase.rpc('exec_sql', {
      sql: `DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;`
    })
    
    if (dropError1) {
      console.error('Error dropping first policy:', dropError1)
      // Continue anyway, policy might not exist
    } else {
      console.log('✅ Dropped old policy 1')
    }

    const { data: dropData2, error: dropError2 } = await supabase.rpc('exec_sql', {
      sql: `DROP POLICY IF EXISTS "Admins can view all consumer scans" ON consumer_qr_scans;`
    })
    
    if (dropError2) {
      console.error('Error dropping second policy:', dropError2)
      // Continue anyway, policy might not exist
    } else {
      console.log('✅ Dropped old policy 2')
    }

    // Step 2: Create new comprehensive policy
    const createPolicySQL = `
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

    const { data: createData, error: createError } = await supabase.rpc('exec_sql', {
      sql: createPolicySQL
    })

    if (createError) {
      console.error('❌ Error creating new policy:', createError)
      
      // Try alternative: Direct SQL via Supabase edge function or return manual instructions
      return NextResponse.json({
        success: false,
        error: createError.message,
        message: 'RPC function not available. Please run SQL manually in Supabase Dashboard:',
        sql: `
DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;
DROP POLICY IF EXISTS "Admins can view all consumer scans" ON consumer_qr_scans;

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
        `.trim()
      }, { status: 500 })
    }

    console.log('✅ Created new policy successfully')

    return NextResponse.json({
      success: true,
      message: 'RLS policy updated! Shops can now view their own QR scans and point balance.',
      actions: [
        'Dropped old restrictive policies',
        'Created new policy allowing shops to view scans where shop_id matches their organization_id',
        'Shops should now see their full point balance (e.g., 1,966 instead of 533)'
      ]
    })

  } catch (error: any) {
    console.error('❌ Migration error:', error)
    return NextResponse.json({ 
      success: false,
      error: error.message,
      instructions: 'Please apply the SQL manually in Supabase SQL Editor (see migrations/034_shop_can_view_own_scans.sql)'
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint to apply RLS policy fix',
    description: 'Allows shops to view consumer_qr_scans where shop_id matches their organization_id',
    issue: 'Shops currently cannot see their QR scans due to restrictive RLS policy'
  })
}
