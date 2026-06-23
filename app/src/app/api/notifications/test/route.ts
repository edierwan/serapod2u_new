import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser, sendWhatsAppMessage } from '@/app/api/settings/whatsapp/_utils'

// Normalize phone number for Baileys (Malaysia preferred)
// Removes non-digits, replaces leading 0 with 60
function normalizeBaileysPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '') // Remove all non-digits
  
  // If starts with 0, replace with 60 (Malaysia)
  // Example: 0123456789 -> 60123456789
  if (cleaned.startsWith('0')) {
    cleaned = '60' + cleaned.substring(1)
  }
  
  return cleaned
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { channel, to } = body

    if (!to) {
      return NextResponse.json({ error: 'Recipient number (to) is required' }, { status: 400 })
    }

    if (channel !== 'whatsapp') {
      return NextResponse.json({ error: 'Only WhatsApp channel is supported for now' }, { status: 400 })
    }

    if (channel === 'whatsapp') {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (!await isAdminUser(supabase, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single()
        if (!profile?.organization_id) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        const normalizedPhone = normalizeBaileysPhone(to)
        const message = 'This is a test message from Serapod2u Notification Settings.'
        try {
            const sent = await sendWhatsAppMessage(supabase, profile.organization_id, { to: normalizedPhone, text: message })
            return NextResponse.json({ success: true, message: `Test message sent via ${sent.providerName}`, data: sent.response })
        } catch (error: any) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
    }
    return NextResponse.json({ error: `Channel ${channel} is not supported for testing` }, { status: 400 })

  } catch (error: any) {
    console.error('Test API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
