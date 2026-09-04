import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import {
  buildTelegramDeepLink,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
} from '@/lib/telegram/constants'
import {
  createTelegramLinkToken,
  getTelegramLinkByUserId,
  unlinkTelegramAccount,
} from '@/lib/telegram/link-service'

export const dynamic = 'force-dynamic'

async function requireDistributorUser() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      organizations:organization_id ( org_type_code, org_name )
    `)
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.organization_id) {
    throw Object.assign(new Error('User profile not found.'), { status: 403 })
  }

  const organization = Array.isArray(profile.organizations)
    ? profile.organizations[0]
    : profile.organizations

  const access = getSerappAccessDecision({
    accountScope: profile.account_scope,
    orgTypeCode: organization?.org_type_code,
    organizationId: profile.organization_id,
    roleLevel: null,
  })

  if (!access.allowed || !access.isDistributor) {
    throw Object.assign(
      new Error('Telegram ordering is available for distributor accounts only.'),
      { status: 403 },
    )
  }

  return {
    userId: user.id,
    orgName: organization?.org_name || 'Distributor',
  }
}

/** POST — create a one-time link code for Telegram /start or /link */
export async function POST() {
  try {
    const { userId } = await requireDistributorUser()
    const existing = await getTelegramLinkByUserId(userId)
    if (existing) {
      return NextResponse.json({
        alreadyLinked: true,
        linkedAt: existing.linked_at,
        telegramUsername: existing.telegram_username,
      })
    }

    const tokenRow = await createTelegramLinkToken(userId)
    const deepLink = buildTelegramDeepLink(tokenRow.token)

    return NextResponse.json({
      token: tokenRow.token,
      expiresAt: tokenRow.expires_at,
      expiresInMinutes: TELEGRAM_LINK_TOKEN_TTL_MINUTES,
      deepLink,
      instructions: deepLink
        ? 'Open the Telegram link or send /link CODE to the bot.'
        : 'Send /link CODE to the Serapod Telegram bot.',
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to create link token.',
    }, { status })
  }
}

/** DELETE — unlink Telegram from this Serapod user */
export async function DELETE() {
  try {
    const { userId } = await requireDistributorUser()
    await unlinkTelegramAccount(userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to unlink.',
    }, { status })
  }
}
