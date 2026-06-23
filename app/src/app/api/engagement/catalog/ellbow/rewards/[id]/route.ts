import { apiErrorResponse, EllbowApiError, getEllbowContext, nonNegativeInteger, requiredText } from '@/lib/server/ellbow-catalog'

type Context = { params: Promise<{ id: string }> }
const STATUSES = ['available', 'scheduled', 'paused', 'expired', 'sold_out']
const VERIFICATION_MODES = ['manual', 'automatic']

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow Loyalty is not initialized', 404)
    const { data, error } = await supabase.from('ellbow_rewards')
      .select('*, category:ellbow_reward_categories(id,name), images:ellbow_reward_images(*)')
      .eq('id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).maybeSingle()
    if (error) throw error
    if (!data) throw new EllbowApiError('Ellbow reward not found', 404)
    return Response.json({ reward: data })
  } catch (error) { return apiErrorResponse(error) }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params
    const body = await request.json()
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow reward not found', 404)
    const { data: category } = await supabase.from('ellbow_reward_categories').select('id')
      .eq('id', body.category_id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).maybeSingle()
    if (!category) throw new EllbowApiError('Invalid Ellbow category', 400)
    const payload = {
      category_id: category.id, name: requiredText(body.name, 'Reward name'), code: requiredText(body.code, 'Reward code', 100),
      description: body.description ? String(body.description).trim() : null,
      points_required: nonNegativeInteger(body.points_required, 'Points required'),
      point_offer: nonNegativeInteger(body.point_offer, 'Point offer', true),
      stock_quantity: nonNegativeInteger(body.stock_quantity, 'Stock quantity', true),
      status: STATUSES.includes(body.status) ? body.status : 'paused',
      verification_mode: VERIFICATION_MODES.includes(body.verification_mode) ? body.verification_mode : 'manual',
      valid_from: body.valid_from || null, valid_until: body.valid_until || null,
      estimated_financial_cost_rm: body.estimated_financial_cost_rm === null || body.estimated_financial_cost_rm === '' ? null : Math.max(0, Number(body.estimated_financial_cost_rm)),
    }
    const { data, error } = await supabase.from('ellbow_rewards').update(payload)
      .eq('id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw new EllbowApiError('Ellbow reward not found', 404)
    return Response.json({ reward: data })
  } catch (error) { return apiErrorResponse(error) }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow reward not found', 404)
    const { data: images } = await supabase.from('ellbow_reward_images').select('storage_path')
      .eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
    const { data, error } = await supabase.from('ellbow_rewards').delete()
      .eq('id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new EllbowApiError('Ellbow reward not found', 404)
    const paths = (images ?? []).map((image: { storage_path: string }) => image.storage_path)
    if (paths.length) await supabase.storage.from('avatars').remove(paths)
    return Response.json({ success: true })
  } catch (error) { return apiErrorResponse(error) }
}
