import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

type Context = { params: Promise<{ id: string }> }
const ALLOWED_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow reward not found', 404)
    const { data: reward } = await supabase.from('ellbow_rewards').select('id')
      .eq('id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).maybeSingle()
    if (!reward) throw new EllbowApiError('Ellbow reward not found', 404)
    const { count } = await supabase.from('ellbow_reward_images').select('*', { count: 'exact', head: true }).eq('reward_id', id)
    if ((count ?? 0) >= 5) throw new EllbowApiError('A reward can have at most 5 images', 400)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new EllbowApiError('Image file is required', 400)
    const extension = ALLOWED_TYPES.get(file.type)
    if (!extension || file.size > 5 * 1024 * 1024) throw new EllbowApiError('Use a JPG, PNG, or WebP image up to 5 MB', 400)
    const storagePath = `loyalty/ellbow/${organizationId}/rewards/${id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) throw uploadError
    const sortOrder = count ?? 0
    const { data, error } = await supabase.from('ellbow_reward_images').insert({
      organization_id: organizationId, loyalty_program_id: program.id, reward_id: id,
      storage_path: storagePath, sort_order: sortOrder, is_default: sortOrder === 0,
    }).select('*').single()
    if (error) { await supabase.storage.from('avatars').remove([storagePath]); throw error }
    return Response.json({ image: data }, { status: 201 })
  } catch (error) { return apiErrorResponse(error) }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params
    const body = await request.json() as { images?: Array<{ id: string; sort_order: number; is_default: boolean }> }
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program || !Array.isArray(body.images) || body.images.length > 5) throw new EllbowApiError('Invalid image order', 400)
    if (body.images.filter(image => image.is_default).length !== 1) throw new EllbowApiError('Exactly one default image is required', 400)
    const { data: existing } = await supabase.from('ellbow_reward_images').select('id')
      .eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
    const allowed = new Set((existing ?? []).map((image: { id: string }) => image.id))
    if (body.images.some(image => !allowed.has(image.id))) throw new EllbowApiError('Image does not belong to this Ellbow reward', 403)
    const { error: defaultError } = await supabase.from('ellbow_reward_images').update({ is_default: false })
      .eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
    if (defaultError) throw defaultError
    for (const image of body.images) {
      const { error } = await supabase.from('ellbow_reward_images').update({ sort_order: image.sort_order, is_default: image.is_default })
        .eq('id', image.id).eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
      if (error) throw error
    }
    return Response.json({ success: true })
  } catch (error) { return apiErrorResponse(error) }
}
