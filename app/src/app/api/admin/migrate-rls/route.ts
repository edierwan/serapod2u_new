import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// This endpoint runs database migrations - USE WITH CAUTION
// Only accessible in development mode
export async function POST(request: Request) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Migration endpoint only available in development' }, { status: 403 })
  }

  try {
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

    // Drop existing policy and create new one
    const migrationSQL = `
      -- Drop existing restrictive policy if it exists
      DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;

      -- Create new policy that allows:
      -- 1. Users to view their own scans (as consumers)
      -- 2. Admins/HQ to view all scans
      -- 3. SHOPS to view scans where they collected the points
      CREATE POLICY "Users and shops can view relevant scans"
        ON consumer_qr_scans
        FOR SELECT
        TO authenticated
        USING (
          -- Users can see their own consumer scans
          consumer_id = auth.uid()
          OR
          -- Shops can see scans where they collected points
          EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.organization_id = consumer_qr_scans.shop_id
          )
          OR
          -- Admins/HQ/Power Users can see all scans
          EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
            AND u.role_code IN ('SA', 'HQ', 'POWER_USER')
          )
        );
    `

    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL })

    if (error) {
      console.error('Migration error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'RLS policy updated successfully. Shops can now view their own scans.' 
    })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
