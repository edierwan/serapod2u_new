import { apiErrorResponse, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { admin, user, program, organizationId } = await getEllbowMemberContext()
    const [{ data: wallets, error: walletError }, { data: rewards, error: rewardError }] = await Promise.all([
      admin.from('ellbow_wallets').select('*').eq('organization_id', organizationId)
        .eq('loyalty_program_id', program.id).eq('owner_user_id', user.id).order('wallet_lane'),
      admin.from('ellbow_rewards')
        .select('*, category:ellbow_reward_categories(id,name), images:ellbow_reward_images(*)')
        .eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
        .eq('status', 'available').or(`valid_from.is.null,valid_from.lte.${new Date().toISOString()}`)
        .or(`valid_until.is.null,valid_until.gte.${new Date().toISOString()}`).order('points_required'),
    ])
    if (walletError) throw walletError
    if (rewardError) throw rewardError
    const mappedRewards = (rewards ?? []).map((reward: any) => {
      const images = [...(reward.images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)
      const image = images.find((item: any) => item.is_default) ?? images[0]
      return { ...reward, item_name: reward.name, item_code: reward.code, item_description: reward.description,
        item_image_url: image?.storage_path ?? null, category: reward.category?.name ?? 'Other' }
    })
    const byLane = Object.fromEntries((wallets ?? []).map((wallet: any) => [wallet.wallet_lane, wallet]))
    return Response.json({ success: true, program, wallets: byLane,
      balance: Number(byLane.consumer?.balance ?? byLane.shop_staff?.balance ?? 0), rewards: mappedRewards })
  } catch (error) { return apiErrorResponse(error) }
}
