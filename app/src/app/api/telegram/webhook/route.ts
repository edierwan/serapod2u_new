import { NextRequest, NextResponse } from 'next/server'
import { getTelegramWebhookSecret } from '@/lib/telegram/constants'
import { processTelegramUpdate } from '@/lib/telegram/handlers'
import type { TelegramUpdate } from '@/lib/telegram/types'

export const dynamic = 'force-dynamic'

/**
 * Telegram Bot webhook (unauthenticated — trust via optional secret token header).
 *
 * POST /api/telegram/webhook
 */
export async function POST(request: NextRequest) {
  const configuredSecret = getTelegramWebhookSecret()
  if (configuredSecret) {
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token')
    if (headerSecret !== configuredSecret) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  let update: TelegramUpdate
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await processTelegramUpdate(update)
  } catch (error) {
    console.error('[telegram/webhook]', error)
  }

  return NextResponse.json({ ok: true })
}
