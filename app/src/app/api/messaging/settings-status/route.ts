import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTelegramBotUsername, getTelegramBotToken, getTelegramWebhookSecret } from '@/lib/telegram/constants'

/**
 * Safe messaging channel status for Settings (never returns secrets).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: requester } = await supabase
      .from('users')
      .select('organization_id, organizations:organization_id ( org_type_code ), roles:role_code ( role_level )')
      .eq('id', user.id)
      .single()

    const organization = Array.isArray(requester?.organizations)
      ? requester?.organizations[0]
      : requester?.organizations
    const roles = Array.isArray((requester as any)?.roles)
      ? (requester as any).roles[0]
      : (requester as any)?.roles
    const orgType = String((organization as { org_type_code?: string } | null)?.org_type_code || '').toUpperCase()
    const roleLevel = Number(roles?.role_level || 999)

    if (orgType !== 'HQ' || roleLevel > 20) {
      return NextResponse.json({ error: 'HQ settings access required.' }, { status: 403 })
    }

    return NextResponse.json({
      messagingOrdersEnabled: true,
      telegram: {
        enabled: Boolean(getTelegramBotToken()),
        botUsername: getTelegramBotUsername(),
        webhookSecretConfigured: Boolean(getTelegramWebhookSecret()),
        tokenConfigured: Boolean(getTelegramBotToken()),
      },
      whatsapp: {
        enabled: false,
        note: 'Official WhatsApp ordering is architecturally reserved; not enabled in Phase 1.',
      },
    })
  } catch (error) {
    console.error('[messaging/settings-status]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load messaging settings.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
