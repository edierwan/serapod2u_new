import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Admin endpoint to fix RLS policy for shop point viewing
 * Run once to apply the migration
 */
export async function POST() {
  try {
    const supabase = await createClient()
    
    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role_code')
      .eq('id', user.id)
      .single()

    if (!profile || !['SA', 'HQ'].includes(profile.role_code)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Execute the migration SQL
    // Note: This requires a database function or direct SQL access
    // For now, return instructions for manual execution
    
    return NextResponse.json({ 
      success: true,
      message: 'Please run the following SQL in Supabase SQL Editor:',
      sql: `
DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;

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
    })
  } catch (error: any) {
    console.error('Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    instructions: 'POST to this endpoint to get migration SQL',
    note: 'Requires admin authentication'
  })
}
