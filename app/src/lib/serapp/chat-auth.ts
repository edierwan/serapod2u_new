import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSerappAccessDecision } from '@/lib/serapp/access'

type SerappActorOk = {
  ok: true
  userId: string
  orgId: string
  orgName: string
  access: ReturnType<typeof getSerappAccessDecision>
  supabase: Awaited<ReturnType<typeof createClient>>
}

type SerappActorErr = { ok: false; error: NextResponse }

export async function requireSerappActor(): Promise<SerappActorOk | SerappActorErr> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: requester, error: requesterError } = await supabase
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      full_name,
      organizations:organization_id ( id, org_name, org_type_code )
    `)
    .eq('id', user.id)
    .single()

  if (requesterError || !requester?.organization_id) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'User organization not found.' }, { status: 403 }),
    }
  }

  const organization = Array.isArray(requester.organizations)
    ? requester.organizations[0]
    : requester.organizations

  const access = getSerappAccessDecision({
    accountScope: requester.account_scope,
    orgTypeCode: organization?.org_type_code,
    organizationId: requester.organization_id,
    roleLevel: null,
  })

  if (!access.allowed) {
    return { ok: false, error: NextResponse.json({ error: access.reason }, { status: 403 }) }
  }

  return {
    ok: true,
    userId: user.id,
    orgId: requester.organization_id as string,
    orgName: (organization as { org_name?: string } | null)?.org_name || 'Distributor',
    access,
    supabase,
  }
}

export function isMissingChatTable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '')
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code || '')
    : ''
  return (
    code === '42P01' ||
    msg.includes('serapp_conversations') ||
    msg.includes('serapp_messages') ||
    msg.toLowerCase().includes('does not exist')
  )
}
