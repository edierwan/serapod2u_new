import { apiErrorResponse, EllbowApiError, getEllbowContext, nonNegativeInteger, requiredText } from '@/lib/server/ellbow-catalog'

const STATUSES = ['available', 'scheduled', 'paused', 'expired', 'sold_out']
const VERIFICATION_MODES = ['manual', 'automatic']

export async function GET() {
  try {
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const { data, error } = await supabase.from('ellbow_rewards')
      .select('*, category:ellbow_reward_categories(id,name), images:ellbow_reward_images(*)')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return Response.json({ program, rewards: data ?? [] })
  } catch (error) { return apiErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const { data: category } = await supabase.from('ellbow_reward_categories').select('id')
      .eq('id', body.category_id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).maybeSingle()
    if (!category) throw new EllbowApiError('Invalid Ellbow category', 400)
    const status = STATUSES.includes(body.status) ? body.status : 'paused'
    const verificationMode = VERIFICATION_MODES.includes(body.verification_mode) ? body.verification_mode : 'manual'
    const payload = {
      organization_id: organizationId, loyalty_program_id: program.id, category_id: category.id,
      name: requiredText(body.name, 'Reward name'), code: requiredText(body.code, 'Reward code', 100),
      description: body.description ? String(body.description).trim() : null,
      points_required: nonNegativeInteger(body.points_required, 'Points required'),
      point_offer: nonNegativeInteger(body.point_offer, 'Point offer', true),
      stock_quantity: nonNegativeInteger(body.stock_quantity, 'Stock quantity', true),
      status, verification_mode: verificationMode,
      valid_from: body.valid_from || null, valid_until: body.valid_until || null,
      estimated_financial_cost_rm: body.estimated_financial_cost_rm === null || body.estimated_financial_cost_rm === '' ? null : Math.max(0, Number(body.estimated_financial_cost_rm)),
    }
    const { data, error } = await supabase.from('ellbow_rewards').insert(payload).select('*').single()
    if (error) throw error
    return Response.json({ reward: data }, { status: 201 })
  } catch (error) { return apiErrorResponse(error) }
}
