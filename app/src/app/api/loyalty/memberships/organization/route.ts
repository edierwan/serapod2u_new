import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { upsertOrganizationProgramMembership } from '@/lib/server/loyalty-memberships'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : ''
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'organizationId is required.' }, { status: 400 })
    }

    const { data: caller } = await admin
      .from('users')
      .select('id, is_active, roles:role_code(role_level)')
      .eq('id', user.id)
      .maybeSingle()
    const role = Array.isArray((caller as any)?.roles) ? (caller as any).roles[0] : (caller as any)?.roles
    if (!caller?.is_active || Number(role?.role_level ?? 999) > 40) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data: organization, error: orgError } = await admin
      .from('organizations')
      .select('id, org_type_code')
      .eq('id', organizationId)
      .maybeSingle()

    if (orgError || !organization) {
      return NextResponse.json({ success: false, error: 'Organization not found.' }, { status: 404 })
    }

    if (organization.org_type_code !== 'SHOP' && organization.org_type_code !== 'DIST') {
      return NextResponse.json({ success: true, skipped: true })
    }

    await upsertOrganizationProgramMembership(admin as any, 'cellera', organization.id, 'legacy_registration', {
      createdBy: user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[loyalty/memberships/organization] failed:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed to enroll organization.' }, { status: 500 })
  }
}
