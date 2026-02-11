import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils'

// Helper to replace variables
function applyTemplate(template: string, variables: any) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`)
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    try {
        // Auth check
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user org
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userProfile?.organization_id) {
            return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const body = await request.json()
        const {
            eventCode,
            channel,
            recipient, // { phone, email, full_name }
            template,
            sampleData  // { order_no, amount, customer_name, ... }
        } = body

        // Prepare message body with variable substitution
        const messageBody = applyTemplate(template || '', sampleData || {})

        if (!messageBody.trim()) {
            return NextResponse.json({ error: 'No template content. Please set a template first.' }, { status: 400 })
        }

        let result: any = { status: 'failed' }

        if (channel === 'whatsapp') {
            // Use the same working utility as /api/settings/whatsapp/test
            const config = await getWhatsAppConfig(supabase, userProfile.organization_id)

            if (!config || !config.baseUrl) {
                return NextResponse.json({ error: 'WhatsApp gateway not configured. Go to Providers tab to set up.' }, { status: 400 })
            }

            const phoneNumber = recipient?.phone || recipient?.phone_number
            if (!phoneNumber) {
                return NextResponse.json({ error: 'Recipient has no phone number' }, { status: 400 })
            }

            try {
                const gwResult = await callGateway(
                    config.baseUrl,
                    config.apiKey,
                    'POST',
                    '/messages/send',
                    {
                        to: phoneNumber,
                        text: messageBody,
                    },
                    config.tenantId
                )

                if (gwResult.ok || gwResult.jid) {
                    result = { status: 'sent', provider_id: gwResult.jid || 'sent', message: 'WhatsApp message sent successfully' }
                } else {
                    result = { status: 'failed', error: gwResult.error || 'Gateway returned error' }
                }
            } catch (err: any) {
                result = { status: 'failed', error: err.message || 'Failed to reach WhatsApp gateway' }
            }
        } else if (channel === 'sms') {
            // SMS placeholder
            result = { status: 'sent', provider_id: `sms-mock-id`, note: 'SMS provider not yet implemented' }
        } else if (channel === 'email') {
            // Email placeholder
            result = { status: 'sent', provider_id: `email-mock-id`, note: 'Email provider not yet implemented' }
        }

        // Log the test send
        try {
            await supabase.from('notification_logs').insert({
                org_id: userProfile.organization_id,
                event_code: eventCode || 'test',
                channel: channel,
                recipient_value: channel === 'email' ? recipient?.email : (recipient?.phone || recipient?.phone_number),
                recipient_type: channel === 'email' ? 'email' : 'phone',
                status: result.status,
                provider_name: channel === 'whatsapp' ? 'baileys' : channel,
                provider_response: result,
                queued_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
            })
        } catch (logErr) {
            console.error('Failed to log test send:', logErr)
        }

        const success = result.status === 'sent'
        return NextResponse.json({ success, result, error: success ? undefined : result.error })

    } catch (error: any) {
        console.error('Test send error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}
