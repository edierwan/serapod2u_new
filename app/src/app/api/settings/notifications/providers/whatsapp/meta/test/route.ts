import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

type MetaTestRequest = {
  action?: 'connection' | 'test-message'
  to?: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
}

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const readMetaError = async (response: Response) => {
  const body = await response.json().catch(() => null)
  return body?.error?.message || `Meta Cloud API returned HTTP ${response.status}`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json() as MetaTestRequest
    const action = body.action
    const phoneNumberId = asString(body.config?.phone_number_id)
    const accessToken = asString(body.credentials?.access_token)

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'Phone Number ID and Permanent Access Token are required.' }, { status: 400 })
    }

    const graphUrl = `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}`
    const headers = { Authorization: `Bearer ${accessToken}` }

    if (action === 'connection') {
      const response = await fetch(`${graphUrl}?fields=display_phone_number,verified_name,quality_rating`, {
        headers,
        cache: 'no-store'
      })
      if (!response.ok) throw new Error(await readMetaError(response))

      const result = await response.json()
      return NextResponse.json({
        success: true,
        phone_number: result.display_phone_number || null,
        verified_name: result.verified_name || null,
        quality_rating: result.quality_rating || null
      })
    }

    if (action === 'test-message') {
      const recipient = asString(body.to).replace(/[^\d]/g, '')
      if (recipient.length < 8) {
        return NextResponse.json({ error: 'Enter a valid recipient phone number with country code.' }, { status: 400 })
      }

      const response = await fetch(`${graphUrl}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { preview_url: false, body: 'This is a test message from Serapod2U notifications.' }
        })
      })
      if (!response.ok) throw new Error(await readMetaError(response))

      const result = await response.json()
      return NextResponse.json({ success: true, message_id: result.messages?.[0]?.id || null })
    }

    return NextResponse.json({ error: 'Unsupported Meta test action.' }, { status: 400 })
  } catch (error: any) {
    console.error('Meta WhatsApp provider test failed:', error)
    return NextResponse.json({ error: error?.message || 'Meta Cloud API request failed' }, { status: 500 })
  }
}
