import { apiErrorResponse, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { admin, user, program, organizationId } = await getEllbowMemberContext()
    const { data, error } = await admin.from('ellbow_wallets').select('*')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).eq('owner_user_id', user.id).order('wallet_lane')
    if (error) throw error
    return Response.json({ success: true, wallets: data ?? [], balance: Number((data ?? []).find((w: any) => w.wallet_lane === 'consumer')?.balance ?? (data ?? []).find((w: any) => w.wallet_lane === 'shop_staff')?.balance ?? 0) })
  } catch (error) { return apiErrorResponse(error) }
}
