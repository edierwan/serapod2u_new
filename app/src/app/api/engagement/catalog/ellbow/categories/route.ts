import { apiErrorResponse, EllbowApiError, getEllbowContext, requiredText } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const { data, error } = await supabase.from('ellbow_reward_categories').select('*')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).order('sort_order')
    if (error) throw error
    return Response.json({ categories: data ?? [] })
  } catch (error) { return apiErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { supabase, organizationId, program } = await getEllbowContext({ initialize: true })
    const { count } = await supabase.from('ellbow_reward_categories').select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
    const { data, error } = await supabase.from('ellbow_reward_categories').insert({
      organization_id: organizationId, loyalty_program_id: program.id,
      name: requiredText(body.name, 'Category name', 80), sort_order: count ?? 0,
    }).select('*').single()
    if (error) throw error
    return Response.json({ category: data }, { status: 201 })
  } catch (error) { return apiErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    if (!body.id) throw new EllbowApiError('Category id is required', 400)
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow category not found', 404)
    const payload: Record<string, unknown> = {}
    if (body.name !== undefined) payload.name = requiredText(body.name, 'Category name', 80)
    if (body.active !== undefined) payload.active = Boolean(body.active)
    const { data, error } = await supabase.from('ellbow_reward_categories').update(payload)
      .eq('id', body.id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) throw new EllbowApiError('Ellbow category not found', 404)
    return Response.json({ category: data })
  } catch (error) { return apiErrorResponse(error) }
}
