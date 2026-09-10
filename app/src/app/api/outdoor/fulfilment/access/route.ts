import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET — whether current user may open Outdoor fulfilment desk. */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ allowed: false })

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('organizations!fk_users_organization(org_type_code), roles(role_level, role_code)')
      .eq('id', user.id)
      .single()

    const orgType = (profile?.organizations as any)?.org_type_code
    const role = (profile?.roles as any) || {}
    const roleLevel = Number(role.role_level ?? 99)
    const roleCode = String(role.role_code || '').toLowerCase()
    const allowed =
      orgType === 'HQ' &&
      (roleLevel <= 30 || ['super_admin', 'admin', 'org_admin', 'warehouse', 'fulfilment'].includes(roleCode))

    return NextResponse.json({ allowed: Boolean(allowed) })
  } catch {
    return NextResponse.json({ allowed: false })
  }
}
