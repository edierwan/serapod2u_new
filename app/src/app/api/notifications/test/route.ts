import { NextRequest, NextResponse } from 'next/server'
import { callGateway } from '@/app/api/settings/whatsapp/_utils'

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
    const { channel, provider, credentials, config, to } = body

    if (!to) {
      return NextResponse.json({ error: 'Recipient number (to) is required' }, { status: 400 })
    }

    if (channel !== 'whatsapp') {
      return NextResponse.json({ error: 'Only WhatsApp channel is supported for now' }, { status: 400 })
    }

    if (provider === 'baileys') {
        const { base_url } = config || {}
        const { api_key } = credentials || {}

        if (!base_url || !api_key) {
            return NextResponse.json({ error: 'Missing Baileys configuration (Base URL or API Key)' }, { status: 400 })
        }

        const normalizedPhone = normalizeBaileysPhone(to)
        const message = 'This is a test message from Serapod2u Notification Settings.'

        // Call Baileys Gateway using centralized utility
        // Uses legacy endpoints (single-tenant)
        
        try {
            // Use callGateway which handles URL sanitization and legacy endpoint mapping
            const result = await callGateway(
                base_url,
                api_key,
                'POST',
                '/messages/send',
                {
                    to: normalizedPhone,
                    text: message
                }
            );

            return NextResponse.json({ success: true, message: 'Test message sent successfully via Baileys', data: result })

        } catch (error: any) {
            console.error('Baileys send error:', error)
             return NextResponse.json({ 
                error: `Failed to send Baileys message: ${error.message}` 
            }, { status: 500 })
        }
    } else if (provider === 'twilio') {
        // Mock for Twilio for now as focus is Baileys
         // In a real implementation we would instantiate Twilio client here
        return NextResponse.json({ 
            success: true, 
            message: 'Twilio test logic not implemented in this update (mock success)' 
        })
    }
    
    return NextResponse.json({ error: `Provider ${provider} not supported for testing` }, { status: 400 })

  } catch (error: any) {
    console.error('Test API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
