import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

export const dynamic = 'force-dynamic'

const participantTypes = new Set(['organization_user', 'shop_staff', 'consumer'])

export async function GET(request: Request) {
  try {
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow Loyalty is not initialized', 404)

    const url = new URL(request.url)
    const search = String(url.searchParams.get('search') || '').trim()
    const status = url.searchParams.get('status')
    const participantType = url.searchParams.get('participant_type')
    const memberOrganizationId = url.searchParams.get('member_organization_id')
    const source = url.searchParams.get('source')

    let query = supabase
      .from('v_ellbow_participant_users')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('loyalty_program_id', program.id)

    if (status && status !== 'all') query = query.eq('status', status)
    if (participantType && participantType !== 'all') query = query.eq('participant_type', participantType)
    if (memberOrganizationId && memberOrganizationId !== 'all') query = query.eq('member_organization_id', memberOrganizationId)
    if (source && source !== 'all') query = query.eq('enrollment_source', source)
    if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,org_name.ilike.%${search}%`)

    const { data, error } = await query.order('enrolled_at', { ascending: false })
    if (error) throw error
    return Response.json({ success: true, users: data ?? [] })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await getEllbowContext()
    const body = await request.json()
    const userId = String(body?.user_id || '').trim()
    const participantType = String(body?.participant_type || '').trim()
    const memberOrganizationId = typeof body?.member_organization_id === 'string' && body.member_organization_id.trim()
      ? body.member_organization_id.trim()
      : null
    const status = body?.status === 'inactive' ? 'inactive' : 'active'
    const reason = typeof body?.reason === 'string' ? body.reason : null

    if (!userId) throw new EllbowApiError('User is required', 400)
    if (!participantTypes.has(participantType)) throw new EllbowApiError('Valid participant type is required', 400)

    const { data, error } = await supabase.rpc('loyalty_program_admin_upsert_user_membership', {
      p_user_id: userId,
      p_participant_type: participantType,
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
  try {
    const { supabase } = await getEllbowContext()
    const body = await request.json()
    const membershipId = typeof body?.membership_id === 'string' ? body.membership_id.trim() : ''
    if (!membershipId) return POST(request)

    const participantType = typeof body?.participant_type === 'string' && body.participant_type.trim()
      ? body.participant_type.trim()
      : null
    const memberOrganizationId = typeof body?.member_organization_id === 'string' && body.member_organization_id.trim()
      ? body.member_organization_id.trim()
      : null
    const status = typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : null
    const reason = typeof body?.reason === 'string' ? body.reason : null

    if (participantType && !participantTypes.has(participantType)) throw new EllbowApiError('Valid participant type is required', 400)

    const { data, error } = await supabase.rpc('loyalty_program_admin_update_user_membership', {
      p_membership_id: membershipId,
      p_participant_type: participantType,
      p_member_organization_id: memberOrganizationId,
      p_status: status,
      p_reason: reason,
    })
    if (error) throw error
    return Response.json({ success: true, result: data })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
