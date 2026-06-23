import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

export async function POST(request: Request) {
  try {
    const { supabase } = await getEllbowContext()
    const body = await request.json()
    if (!body.owner_user_id || !['consumer','shop_staff'].includes(body.wallet_lane)) throw new EllbowApiError('Invalid wallet adjustment target', 400)
    if (!String(body.reason || '').trim()) throw new EllbowApiError('Adjustment reason is required', 400)
    const delta = Number(body.points_delta); if (!Number.isInteger(delta) || delta === 0) throw new EllbowApiError('Point delta must be a non-zero integer', 400)
    const { data, error } = await supabase.rpc('ellbow_admin_adjust_points', {
      p_owner_user_id: body.owner_user_id, p_wallet_lane: body.wallet_lane, p_points_delta: delta,
      p_reason: String(body.reason).trim(), p_idempotency_key: String(body.idempotency_key || crypto.randomUUID()),
    })
    if (error) throw new EllbowApiError(error.message, error.message.includes('Insufficient') ? 400 : 422)
    return Response.json(data)
  } catch (error) { return apiErrorResponse(error) }
}
