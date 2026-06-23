import { apiErrorResponse, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function GET(request: Request) {
  try {
    const { admin, user, program, organizationId } = await getEllbowMemberContext()
    const url = new URL(request.url); const lane = url.searchParams.get('lane')
    let query = admin.from('ellbow_point_transactions').select('*').eq('organization_id', organizationId)
      .eq('loyalty_program_id', program.id).eq('owner_user_id', user.id).order('created_at', { ascending: false }).limit(200)
    if (lane === 'consumer' || lane === 'shop_staff') query = query.eq('wallet_lane', lane)
    const { data, error } = await query
    if (error) throw error
    return Response.json({ success: true, transactions: (data ?? []).map((row: any) => ({ ...row,
      points: Number(row.points_delta), date: row.created_at, product_name: row.description, balance_after: Number(row.balance_after) })) })
  } catch (error) { return apiErrorResponse(error) }
}
