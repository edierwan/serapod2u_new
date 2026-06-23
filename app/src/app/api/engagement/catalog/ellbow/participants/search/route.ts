import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { supabase, organizationId } = await getEllbowContext()
    const url = new URL(request.url)
    const target = url.searchParams.get('target')
    const search = String(url.searchParams.get('search') || '').trim()
    if (!search || search.length < 2) return Response.json({ success: true, rows: [] })

    if (target === 'organizations') {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code, city, states(state_name)')
        .or(`org_name.ilike.%${search}%,org_code.ilike.%${search}%,city.ilike.%${search}%`)
        .neq('org_type_code', 'HQ')
        .limit(20)
      if (error) throw error
      return Response.json({ success: true, rows: data ?? [] })
    }

    if (target === 'users') {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, phone, organization_id, organizations(org_name)')
        .eq('is_active', true)
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(20)
      if (error) throw error
      return Response.json({ success: true, rows: data ?? [] })
    }

    if (target === 'member-organizations') {
      const { data, error } = await supabase
        .from('v_ellbow_participant_organizations')
        .select('member_organization_id, org_name, org_type_code')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .or(`org_name.ilike.%${search}%,org_type_code.ilike.%${search}%`)
        .limit(20)
      if (error) throw error
      return Response.json({ success: true, rows: data ?? [] })
    }

    throw new EllbowApiError('Invalid search target', 400)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
