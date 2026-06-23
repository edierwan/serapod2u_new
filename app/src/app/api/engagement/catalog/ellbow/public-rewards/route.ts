import { NextResponse } from 'next/server'
import { resolveRoadtourExperience } from '@/lib/roadtour/experience-registry'
import { resolveRoadtourByToken, validateRoadtourToken } from '@/lib/roadtour/server'
import { createAdminClient } from '@/lib/supabase/admin'

function isCurrentlyAvailable(reward: { valid_from: string | null; valid_until: string | null }) {
  const now = Date.now()
  const validFrom = reward.valid_from ? Date.parse(reward.valid_from) : null
  const validUntil = reward.valid_until ? Date.parse(reward.valid_until) : null
  return (validFrom === null || validFrom <= now) && (validUntil === null || validUntil >= now)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('rt')?.trim()

  if (!token) {
    return NextResponse.json({ success: false, error: 'RoadTour token is required' }, { status: 400 })
  }

  const validation = await validateRoadtourToken(token)
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error || 'Invalid RoadTour token' }, { status: 404 })
  }

  const qr = await resolveRoadtourByToken(token)
  if (!qr || resolveRoadtourExperience(qr.product_category).key !== 'pet_food') {
    return NextResponse.json({ success: false, error: 'Ellbow RoadTour experience not found' }, { status: 404 })
  }

  const organizationId = validation.data?.org_id || qr.org_id
  if (!organizationId) {
    return NextResponse.json({ success: false, error: 'RoadTour organization is missing' }, { status: 422 })
  }

  const admin = createAdminClient() as any
  const { data: program, error: programError } = await admin
    .from('loyalty_programs')
    .select('id, organization_id, code, name, active')
    .eq('organization_id', organizationId)
    .eq('code', 'ellbow')
    .eq('active', true)
    .maybeSingle()

  if (programError) {
    return NextResponse.json({ success: false, error: programError.message }, { status: 500 })
  }

  if (!program) {
    return NextResponse.json({ success: true, rewards: [] })
  }

  const nowIso = new Date().toISOString()
  const { data: rewards, error: rewardsError } = await admin
    .from('ellbow_rewards')
    .select(`
      id,
      name,
      points_required,
      point_offer,
      status,
      valid_from,
      valid_until,
      category:ellbow_reward_categories(id,name),
      images:ellbow_reward_images(storage_path,is_default,sort_order)
    `)
    .eq('organization_id', organizationId)
    .eq('loyalty_program_id', program.id)
    .eq('status', 'available')
    .or(`valid_from.is.null,valid_from.lte.${nowIso}`)
    .or(`valid_until.is.null,valid_until.gte.${nowIso}`)
    .order('points_required', { ascending: true })
    .limit(12)

  if (rewardsError) {
    return NextResponse.json({ success: false, error: rewardsError.message }, { status: 500 })
  }

  const publicRewards = (rewards ?? [])
    .filter(isCurrentlyAvailable)
    .map((reward: any) => {
      const images = [...(reward.images ?? [])].sort((a: any, b: any) => Number(a.sort_order) - Number(b.sort_order))
      const image = images.find((item: any) => item.is_default) ?? images[0]

      return {
        id: reward.id,
        item_name: reward.name,
        points_required: reward.points_required,
        point_offer: reward.point_offer,
        item_image_url: image?.storage_path ?? null,
        category: reward.category?.name ?? 'Other',
        availability_status: reward.status,
      }
    })

  return NextResponse.json({ success: true, rewards: publicRewards })
}
