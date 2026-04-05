import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/qr-monitoring/stats
 *
 * Returns aggregated QR verification statistics for the recovery monitor dashboard.
 * Requires HQ admin (role_level <= 50) — enforced via RLS on the views.
 *
 * Note: The views (v_qr_recovery_summary, etc.) are created by migration
 * 20260404_qr_verification_log.sql and are not yet in the generated TypeScript types.
 * We use `as any` to bypass the typed client until types are regenerated.
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = createAdminClient() as any

    // Fetch all three views in parallel
    const [summaryRes, candidatesRes, hourlyRes] = await Promise.all([
      supabaseAdmin
        .from('v_qr_recovery_summary')
        .select('*'),
      supabaseAdmin
        .from('v_qr_recovery_candidates')
        .select('*')
        .limit(200),
      supabaseAdmin
        .from('v_qr_scan_hourly_stats')
        .select('*')
        .limit(720), // 30 days × 24 hours
    ])

    if (summaryRes.error) {
      console.error('Error fetching summary:', summaryRes.error)
    }
    if (candidatesRes.error) {
      console.error('Error fetching candidates:', candidatesRes.error)
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: summaryRes.data ?? [],
        candidates: candidatesRes.data ?? [],
        hourly: hourlyRes.data ?? [],
      },
    })
  } catch (error) {
    console.error('Error in qr-monitoring stats:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
