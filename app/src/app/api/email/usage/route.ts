import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/email/usage
 * Get email usage statistics for the current organization
 * Shows daily usage count for Gmail limit tracking
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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

    // Get user's organization
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Get provider from query params (default to gmail)
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') || 'gmail'
    const days = parseInt(searchParams.get('days') || '7')

    // Get today's count using the database function
    const { data: todayCount, error: todayError } = await supabase
      .rpc('get_email_count_today', {
        p_org_id: userProfile.organization_id,
        p_provider: provider
      })

    if (todayError) {
      console.error('Error getting today count:', todayError)
    }

    // Get stats for the last N days
    const { data: stats, error: statsError } = await supabase
      .rpc('get_email_stats', {
        p_org_id: userProfile.organization_id,
        p_provider: provider,
        p_days: days
      })

    if (statsError) {
      console.error('Error getting stats:', statsError)
    }

    return NextResponse.json({
      success: true,
      provider,
      today_count: todayCount || 0,
      daily_limit: provider === 'gmail' ? 500 : null,
      usage_percentage: provider === 'gmail' ? ((todayCount || 0) / 500 * 100).toFixed(1) : null,
      remaining: provider === 'gmail' ? Math.max(0, 500 - (todayCount || 0)) : null,
      stats: stats || [],
      warning: provider === 'gmail' && (todayCount || 0) >= 350,
      critical: provider === 'gmail' && (todayCount || 0) >= 450
    })

  } catch (error: any) {
    console.error('❌ Email usage error:', error)
    return NextResponse.json(
      { error: 'Failed to get email usage', details: error.message },
      { status: 500 }
    )
  }
}

