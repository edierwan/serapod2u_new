import { apiErrorResponse, EllbowApiError, getEllbowContext, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { admin, user, program, organizationId } = await getEllbowMemberContext()
    const { data, error } = await admin.from('v_ellbow_redemption_history').select('*')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    const redemptions = (data ?? []).map((row: any) => ({ ...row, date: row.requested_at,
      points_deducted: Number(row.points_used), reward: { name: row.reward_name, image_url: row.metadata?.image_url ?? null } }))
    return Response.json({ success: true, redemptions })
  } catch (error) { return apiErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const { supabase } = await getEllbowContext()
    const body = await request.json()
    if (!body.id || !body.status) throw new EllbowApiError('Redemption id and status are required', 400)
    const { data, error } = await supabase.rpc('ellbow_update_redemption_status', { p_redemption_id: body.id, p_status: body.status, p_notes: body.notes || null })
    if (error) throw new EllbowApiError(error.message, 422)
    return Response.json(data)
  } catch (error) { return apiErrorResponse(error) }
}
