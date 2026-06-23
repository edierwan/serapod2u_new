import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const ELLBOW_CATEGORY_NAMES = [
  'Pet Food', 'Pet Accessories', 'Gifts', 'Cashback', 'Vouchers', 'Points', 'Other',
] as const

export class EllbowApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function getEllbowContext({ initialize = false }: { initialize?: boolean } = {}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new EllbowApiError('Unauthorized', 401)

  const { data: profile, error: profileError } = await (supabase as any)
    .from('users')
    .select('organization_id, is_active, roles:role_code(role_level)')
    .eq('id', user.id)
    .single()
  const role = Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles
  if (profileError || !profile?.is_active || !role || Number(role.role_level) > 40) {
    throw new EllbowApiError('Forbidden', 403)
  }

  let { data: program, error: programError } = await (supabase as any)
    .from('loyalty_programs')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('code', 'ellbow')
    .maybeSingle()
  if (programError) throw programError

  if (initialize && !program) {
    const result = await (supabase as any).from('loyalty_programs').upsert({
      organization_id: profile.organization_id,
      code: 'ellbow',
      name: 'Ellbow Loyalty',
      active: false,
    }, { onConflict: 'organization_id,code' }).select('*').single()
    if (result.error) throw result.error
    program = result.data
  }

  if (initialize && program) {
    const categories = ELLBOW_CATEGORY_NAMES.map((name, sort_order) => ({
      organization_id: profile.organization_id,
      loyalty_program_id: program.id,
      name,
      sort_order,
    }))
    const categoryResult = await (supabase as any).from('ellbow_reward_categories').upsert(categories, {
      onConflict: 'organization_id,loyalty_program_id,name', ignoreDuplicates: true,
    })
    if (categoryResult.error) throw categoryResult.error
    const settingsResult = await (supabase as any).from('ellbow_loyalty_settings').upsert({
      organization_id: profile.organization_id,
      loyalty_program_id: program.id,
    }, { onConflict: 'organization_id,loyalty_program_id', ignoreDuplicates: true })
    if (settingsResult.error) throw settingsResult.error
  }

  return { supabase: supabase as any, user, organizationId: profile.organization_id as string, program }
}

/** Resolve an authenticated member's Ellbow company without trusting request input. */
export async function getEllbowMemberContext() {
  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) throw new EllbowApiError('Unauthorized', 401)
  const admin = createAdminClient() as any
  const { data: profile, error: profileError } = await admin.from('users')
    .select('id, organization_id, is_active, full_name, email, phone, referral_phone')
    .eq('id', user.id).single()
  if (profileError || !profile?.is_active) throw new EllbowApiError('Forbidden', 403)

  let program: any = null
  const { data: existingWallet } = await admin.from('ellbow_wallets')
    .select('organization_id, loyalty_program_id')
    .eq('owner_user_id', user.id).limit(1).maybeSingle()
  if (existingWallet) {
    const { data: walletProgram } = await admin.from('loyalty_programs').select('*')
      .eq('id', existingWallet.loyalty_program_id).eq('organization_id', existingWallet.organization_id).eq('code', 'ellbow').maybeSingle()
    program = walletProgram
  }

  let organizationId: string | null = profile.organization_id
  const visited = new Set<string>()
  while (!program && organizationId && !visited.has(organizationId)) {
    visited.add(organizationId)
    const { data: candidate } = await admin.from('loyalty_programs').select('*')
      .eq('organization_id', organizationId).eq('code', 'ellbow').maybeSingle()
    if (candidate) { program = candidate; break }
    const { data: organization } = await admin.from('organizations').select('parent_org_id').eq('id', organizationId).maybeSingle()
    organizationId = organization?.parent_org_id ?? null
  }
  if (!program) throw new EllbowApiError('Ellbow Loyalty is not available for this user', 404)
  return { sessionClient: sessionClient as any, admin, user, profile, program, organizationId: program.organization_id as string }
}

export function apiErrorResponse(error: unknown) {
  const status = error instanceof EllbowApiError ? error.status : 500
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return Response.json({ error: message }, { status })
}

export function nonNegativeInteger(value: unknown, field: string, nullable = false) {
  if (nullable && (value === null || value === '')) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new EllbowApiError(`${field} must be a non-negative integer`, 400)
  return number
}

export function requiredText(value: unknown, field: string, max = 200) {
  const text = String(value ?? '').trim()
  if (!text || text.length > max) throw new EllbowApiError(`${field} is required and must be at most ${max} characters`, 400)
  return text
}
