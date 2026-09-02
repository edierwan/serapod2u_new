import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { listSerappDoStories } from '@/lib/serapp/do-service'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        account_scope,
        organizations:organization_id ( id, org_type_code )
      `)
      .eq('id', user.id)
      .single()

    if (requesterError || !requester?.organization_id) {
      return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })
    }

    const org = Array.isArray(requester.organizations) ? requester.organizations[0] : requester.organizations
    const access = getSerappAccessDecision({
      accountScope: requester.account_scope,
      orgTypeCode: org?.org_type_code,
      organizationId: requester.organization_id,
      roleLevel: null,
    })
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 })
    }

    const url = new URL(request.url)
    const limit = Math.max(1, Math.min(10, Number(url.searchParams.get('limit') || 5)))
    const admin = createAdminClient()
    const stories = await listSerappDoStories(admin, {
      organizationId: requester.organization_id,
      isHqSupport: access.isHqSupport,
      limit,
    })

    return NextResponse.json({ stories })
  } catch (error) {
    console.error('[serapp/do-status]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load DO stories.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
