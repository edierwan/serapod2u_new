import { apiErrorResponse, EllbowApiError, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function POST(request: Request) {
  try {
    const { sessionClient } = await getEllbowMemberContext()
    const body = await request.json()
    if (!body.reward_id) throw new EllbowApiError('Reward ID is required', 400)
    const requestKey = String(body.request_key || crypto.randomUUID())
    const { data, error } = await sessionClient.rpc('ellbow_redeem_reward', { p_reward_id: body.reward_id, p_request_key: requestKey })
    if (error) throw new EllbowApiError(error.message, error.message.includes('Insufficient') ? 400 : 422)
    return Response.json({ ...data, success: true, points_deducted: data.points_used })
  } catch (error) { return apiErrorResponse(error) }
}
