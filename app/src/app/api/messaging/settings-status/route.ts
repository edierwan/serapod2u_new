import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTelegramBotUsername, getTelegramBotToken, getTelegramWebhookSecret } from '@/lib/telegram/constants'

async function assertHqSettingsAccess(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: requester } = await supabase
    .from('users')
    .select('id, organization_id, organizations:organization_id ( org_type_code ), roles:role_code ( role_level )')
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
  const hqOrgId = requester?.organization_id as string | undefined

  if (orgType !== 'HQ' || roleLevel > 20 || !hqOrgId) {
    return { error: NextResponse.json({ error: 'HQ settings access required.' }, { status: 403 }) }
  }

  return { user, hqOrgId }
}

/** Messaging & Order Channels settings (§6). Secrets stay server-side. */
export async function GET() {
  try {
    const supabase = await createClient()
    const gate = await assertHqSettingsAccess(supabase)
    if ('error' in gate && gate.error) return gate.error

    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('messaging_channel_settings')
      .select('*')
      .eq('hq_organization_id', gate.hqOrgId!)
      .maybeSingle()

    return NextResponse.json({
      messagingOrdersEnabled: settings?.messaging_orders_enabled ?? true,
      telegram: {
        orderingEnabled: settings?.telegram_ordering_enabled ?? true,
        notificationsEnabled: settings?.telegram_notifications_enabled ?? true,
        enabled: Boolean(getTelegramBotToken()),
        botUsername: getTelegramBotUsername(),
        webhookSecretConfigured: Boolean(getTelegramWebhookSecret()),
        tokenConfigured: Boolean(getTelegramBotToken()),
        warehouseChatConfigured: Boolean(
          settings?.warehouse_telegram_chat_id || process.env.TELEGRAM_WAREHOUSE_CHAT_ID,
        ),
        financeChatConfigured: Boolean(
          settings?.finance_telegram_chat_id || process.env.TELEGRAM_FINANCE_CHAT_ID,
        ),
      },
      whatsapp: {
        orderingEnabled: settings?.whatsapp_ordering_enabled ?? false,
        note: 'Official WhatsApp ordering is architecturally reserved; not enabled in Phase 1.',
      },
      settings: settings
        ? {
            defaultFulfillmentWarehouseId: settings.default_fulfillment_warehouse_id,
            warehouseTelegramChatId: settings.warehouse_telegram_chat_id,
            financeTelegramChatId: settings.finance_telegram_chat_id,
          }
        : null,
    })
  } catch (error) {
    console.error('[messaging/settings-status]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load messaging settings.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const gate = await assertHqSettingsAccess(supabase)
    if ('error' in gate && gate.error) return gate.error

    const body = await request.json().catch(() => null)
    const admin = createAdminClient()

    const patch = {
      hq_organization_id: gate.hqOrgId,
      messaging_orders_enabled: body?.messagingOrdersEnabled ?? true,
      telegram_ordering_enabled: body?.telegram?.orderingEnabled ?? true,
      telegram_notifications_enabled: body?.telegram?.notificationsEnabled ?? true,
      whatsapp_ordering_enabled: body?.whatsapp?.orderingEnabled ?? false,
      default_fulfillment_warehouse_id: body?.settings?.defaultFulfillmentWarehouseId ?? null,
      warehouse_telegram_chat_id: body?.settings?.warehouseTelegramChatId ?? null,
      finance_telegram_chat_id: body?.settings?.financeTelegramChatId ?? null,
      updated_by: gate.user!.id,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await admin
      .from('messaging_channel_settings')
      .upsert(patch, { onConflict: 'hq_organization_id' })
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, settings: data })
  } catch (error) {
    console.error('[messaging/settings-status PATCH]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save messaging settings.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
