import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    // Create admin client inside the function to bypass RLS
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { searchParams } = new URL(request.url)
    const journeyConfigId = searchParams.get('journey_config_id')

    if (!journeyConfigId) {
      return NextResponse.json(
        { success: false, error: 'Journey config ID is required' },
        { status: 400 }
      )
    }

    // Check active status for each game type in parallel
    const checkStatus = async (table: string) => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('journey_config_id', journeyConfigId)
        .eq('status', 'active')
      
      if (error) {
        console.error(`Error checking ${table}:`, error)
        return false
      }
      return (count || 0) > 0
    }

    const [scratchActive, spinActive, quizActive] = await Promise.all([
      checkStatus('scratch_card_campaigns'),
      checkStatus('spin_wheel_campaigns'),
      checkStatus('daily_quiz_campaigns')
    ])

    return NextResponse.json({
      success: true,
      activeGames: {
        scratch: scratchActive,
        spin: spinActive,
        quiz: quizActive
      }
    })
  } catch (error: any) {
    console.error('Error in active-games API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
