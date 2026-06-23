import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

type Context = { params: Promise<{ id: string; imageId: string }> }

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id, imageId } = await params
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow image not found', 404)
    const { data: image } = await supabase.from('ellbow_reward_images').select('*')
      .eq('id', imageId).eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id).maybeSingle()
    if (!image) throw new EllbowApiError('Ellbow image not found', 404)
    const { error } = await supabase.from('ellbow_reward_images').delete()
      .eq('id', imageId).eq('reward_id', id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
    if (error) throw error
    await supabase.storage.from('avatars').remove([image.storage_path])
    const { data: remaining } = await supabase.from('ellbow_reward_images').select('id,is_default,sort_order').eq('reward_id', id).order('sort_order')
    if (image.is_default && remaining?.length) await supabase.from('ellbow_reward_images').update({ is_default: true }).eq('id', remaining[0].id)
    return Response.json({ success: true })
  } catch (error) { return apiErrorResponse(error) }
}
