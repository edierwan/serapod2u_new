import { apiErrorResponse, EllbowApiError, getEllbowContext } from '@/lib/server/ellbow-catalog'

type Context = { params: Promise<{ report: string }> }
export async function GET(request: Request, { params }: Context) {
  try {
    const { report } = await params
    const { supabase, organizationId, program } = await getEllbowContext()
    if (!program) throw new EllbowApiError('Ellbow Loyalty is not initialized', 404)
    const url = new URL(request.url); const search = String(url.searchParams.get('search') || '').trim(); const status = url.searchParams.get('status')
    if (report === 'shops') {
      let orgQuery = supabase.from('v_ellbow_participant_organizations').select('*')
        .eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
      if (status && status !== 'all') orgQuery = orgQuery.eq('status', status)
      if (search) orgQuery = orgQuery.or(`org_name.ilike.%${search}%,city.ilike.%${search}%,state_name.ilike.%${search}%`)
      const [{ data: orgRows, error: orgError }, { data: userRows, error: userError }] = await Promise.all([
        orgQuery.order('enrolled_at', { ascending: false }),
        supabase.from('v_ellbow_participant_users').select('*').eq('organization_id', organizationId).eq('loyalty_program_id', program.id),
      ])
      if (orgError) throw orgError
      if (userError) throw userError
      const usersByOrg = new Map<string, any[]>()
      for (const row of userRows ?? []) {
        const key = row.member_organization_id || 'independent'
        usersByOrg.set(key, [...(usersByOrg.get(key) ?? []), row])
      }
      const rows = (orgRows ?? []).map((org: any) => {
        const users = usersByOrg.get(org.member_organization_id) ?? []
        return {
          ...org,
          shop_id: org.member_organization_id,
          shop_name: org.org_name,
          wallet_lane: 'organization',
          balance: users.reduce((sum, row) => sum + Number(row.wallet_balance ?? 0), 0),
          total_earned: users.reduce((sum, row) => sum + Number(row.total_earned ?? 0), 0),
          total_redeemed: users.reduce((sum, row) => sum + Number(row.total_redeemed ?? 0), 0),
          transaction_count: users.filter((row) => row.last_activity_at).length,
          user_count: users.length,
          active_members: users.filter((row) => row.status === 'active').length,
          last_activity_at: users.map((row) => row.last_activity_at).filter(Boolean).sort().at(-1) ?? null,
        }
      })
      return Response.json({ success: true, rows })
    }
    if (['shop-staff','consumers'].includes(report)) {
      let query = supabase.from('v_ellbow_participant_users').select('*')
        .eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
        .eq('participant_type', report === 'shop-staff' ? 'shop_staff' : 'consumer')
      if (status && status !== 'all') query = query.eq('status', status)
      if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,org_name.ilike.%${search}%`)
      const { data, error } = await query.order('wallet_balance', { ascending: false })
      if (error) throw error
      return Response.json({ success: true, rows: (data ?? []).map((row: any) => ({
        ...row,
        wallet_lane: row.participant_type,
        balance: Number(row.wallet_balance ?? 0),
        transaction_count: row.last_activity_at ? 1 : 0,
      })) })
    }
    if (report === 'redemptions') {
      let query = supabase.from('v_ellbow_redemption_history').select('*').eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
      if (status && status !== 'all') query = query.eq('status', status)
      if (search) query = query.or(`reward_name.ilike.%${search}%,user_name.ilike.%${search}%,redemption_code.ilike.%${search}%`)
      const { data, error } = await query.order('created_at', { ascending: false }); if (error) throw error
      return Response.json({ success: true, rows: data ?? [] })
    }
    if (report === 'referrals') {
      const { data, error } = await supabase.from('v_ellbow_referral_monitor').select('*')
        .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).order('created_at', { ascending: false })
      if (error) throw error; return Response.json({ success: true, rows: data ?? [] })
    }
    throw new EllbowApiError('Unknown Ellbow report', 404)
  } catch (error) { return apiErrorResponse(error) }
}
