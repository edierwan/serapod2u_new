import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { getTelegramBotUsername } from '@/lib/telegram/constants'
import { getTelegramLinkByUserId } from '@/lib/telegram/link-service'

export const dynamic = 'force-dynamic'

/** GET — linked Telegram status for the current distributor user */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        account_scope,
        organizations:organization_id ( org_type_code, org_name )
      `)
      .eq('id', user.id)
      .single()

    const organization = Array.isArray(profile?.organizations)
      ? profile.organizations[0]
      : profile?.organizations

    const access = getSerappAccessDecision({
      accountScope: profile?.account_scope,
      orgTypeCode: organization?.org_type_code,
      organizationId: profile?.organization_id,
      roleLevel: null,
    })

    if (!access.allowed || !access.isDistributor) {
      return NextResponse.json({ error: 'Distributor access required.' }, { status: 403 })
    }

    const link = await getTelegramLinkByUserId(user.id)

    return NextResponse.json({
      linked: Boolean(link),
      botUsername: getTelegramBotUsername(),
      link: link
        ? {
            linkedAt: link.linked_at,
            telegramUsername: link.telegram_username,
            telegramFirstName: link.telegram_first_name,
            lastMessageAt: link.last_message_at,
            hasDraft: Boolean(link.session_json?.pasteText),
            lastOrderNo: link.session_json?.lastOrderNo || null,
          }
        : null,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Status check failed.',
    }, { status: 500 })
  }
}
