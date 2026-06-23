import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow Loyalty is not initialized', 404)

    const url = new URL(request.url)
    const search = String(url.searchParams.get('search') || '').trim()
    const status = url.searchParams.get('status')
    const orgType = url.searchParams.get('org_type')
    const source = url.searchParams.get('source')

    let query = supabase
      .from('v_ellbow_participant_organizations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('loyalty_program_id', program.id)

    if (status && status !== 'all') query = query.eq('status', status)
    if (orgType && orgType !== 'all') query = query.eq('org_type_code', orgType)
    if (source && source !== 'all') query = query.eq('enrollment_source', source)
    if (search) query = query.or(`org_name.ilike.%${search}%,city.ilike.%${search}%,state_name.ilike.%${search}%`)

    const { data, error } = await query.order('enrolled_at', { ascending: false })
    if (error) throw error
    return Response.json({ success: true, organizations: data ?? [] })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await getEllbowContext()
    const body = await request.json()
    const memberOrganizationId = String(body?.member_organization_id || '').trim()
    const status = body?.status === 'inactive' ? 'inactive' : 'active'
    const reason = typeof body?.reason === 'string' ? body.reason : null
    if (!memberOrganizationId) throw new EllbowApiError('Organization is required', 400)

    const { data, error } = await supabase.rpc('loyalty_program_admin_upsert_organization_membership', {
      p_member_organization_id: memberOrganizationId,
      p_program_code: 'ellbow',
      p_status: status,
      p_reason: reason,
    })
    if (error) throw error
    return Response.json({ success: true, result: data })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  return POST(request)
}
