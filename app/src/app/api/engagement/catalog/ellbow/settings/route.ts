import { apiErrorResponse, EllbowApiError, getEllbowContext, nonNegativeInteger } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const { data, error } = await supabase.from('ellbow_loyalty_settings').select('*')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).single()
    if (error) throw error
    return Response.json({ settings: data })
  } catch (error) { return apiErrorResponse(error) }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    if (!['single', 'dual'].includes(body.claim_mode)) throw new EllbowApiError('Invalid claim mode', 400)
    const pointValue = Number(body.point_value_rm)
    if (!Number.isFinite(pointValue) || pointValue < 0) throw new EllbowApiError('Point value must be non-negative', 400)
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const payload = {
      active: Boolean(body.active), claim_mode: body.claim_mode,
      staff_points_per_scan: nonNegativeInteger(body.staff_points_per_scan, 'Staff points'),
      consumer_points_per_scan: nonNegativeInteger(body.consumer_points_per_scan, 'Consumer points'),
      point_value_rm: pointValue,
      roadtour_reward_points: nonNegativeInteger(body.roadtour_reward_points, 'RoadTour reward points'),
      registration_bonus: nonNegativeInteger(body.registration_bonus, 'Registration bonus'),
      referral_incentive_default: nonNegativeInteger(body.referral_incentive_default, 'Referral incentive'),
    }
    const { data, error } = await supabase.from('ellbow_loyalty_settings').update(payload)
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).select('*').single()
    if (error) throw error
    const { error: programError } = await supabase.from('loyalty_programs').update({ active: payload.active })
      .eq('id', program.id).eq('organization_id', organizationId).eq('code', 'ellbow')
    if (programError) throw programError
    return Response.json({ settings: data })
  } catch (error) { return apiErrorResponse(error) }
}
