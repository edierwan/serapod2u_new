import { NextRequest, NextResponse } from 'next/server'

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

        // Call Baileys Gateway
        // POST {base_url}/send
        // headers: Content-Type: application/json, x-api-key: api_key
        // body: { to: "<msisdn>", message: "<text>" }
        
        try {
            // Ensure no trailing slash on base_url
            const url = base_url.replace(/\/$/, '') + '/send'
            
            console.log(`Sending Baileys message to ${normalizedPhone} via ${url}`)
            
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key
                },
                body: JSON.stringify({
                    to: normalizedPhone,
                    message: message
                }),
                signal: controller.signal
            })
            
            clearTimeout(timeoutId)

            if (!response.ok) {
                const text = await response.text()
                throw new Error(`Baileys Gateway Error: ${response.status} ${text}`)
            }
            
            const result = await response.json()
            
            // Check specific success flag if server returns one
            // Requirement: handle response: if ok true => success else failure.
            if (result.ok === false || result.status === 'error') {
                 throw new Error(result.message || 'Unknown Baileys error')
            }

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
