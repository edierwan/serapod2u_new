import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role_code')
        .eq('id', user.id)
        .single()
        
    if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const targetType = searchParams.get('targetType') || 'all'
    const statesParam = searchParams.get('states')
    const rolesParam = searchParams.get('roles')

    let query = supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .not('email', 'is', null)

    // Apply filters based on target type
    if (targetType === 'state' && statesParam) {
      const statesList = statesParam.split(',').filter(Boolean)
      if (statesList.length > 0) {
        // Get organizations in these states and their users
        const { data: orgs } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .in('state', statesList)

        if (orgs && orgs.length > 0) {
          const orgIds = orgs.map(o => o.id)
          query = query.in('company_id', orgIds)
        } else {
          // No orgs found in these states
          return NextResponse.json({ count: 0 })
        }
      }
    } else if (targetType === 'role' && rolesParam) {
      const rolesList = rolesParam.split(',').filter(Boolean)
      if (rolesList.length > 0) {
        // Map friendly role names to actual role codes
        const roleMapping: Record<string, string[]> = {
          'consumer': ['consumer', 'CONSUMER'],
          'shop': ['shop', 'SHOP', 'shop_owner'],
          'SA': ['SA', 'SALES_AGENT'],
          'HQ': ['HQ', 'HQ_ADMIN', 'POWER_USER', 'admin', 'super_admin']
        }
        
        const actualRoles = rolesList.flatMap(r => roleMapping[r] || [r])
        query = query.in('role_code', actualRoles)
      }
    }

    const { count, error } = await query

    if (error) {
      console.error('Error getting preview count:', error)
      return NextResponse.json({ error: 'Failed to get count' }, { status: 500 })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
