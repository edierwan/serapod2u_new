import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: campaignId } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's org_id and profile info
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id, full_name')
            .eq('id', user.id)
            .single();
        
        const orgId = userProfile?.organization_id;
        if (!orgId) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 });
        }

        // Get the campaign
        const { data: campaign, error: campaignError } = await (supabase as any)
            .from('marketing_campaigns')
            .select('*')
            .eq('id', campaignId)
            .single();

        if (campaignError || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }

        // Check if already sending
        if (campaign.status === 'sending') {
            return NextResponse.json({ error: 'Campaign is already sending' }, { status: 400 });
        }

        // Resolve recipients
        const audienceFilters = campaign.audience_filters || {};
        const audienceRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/wa/marketing/audience/resolve`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Cookie': request.headers.get('cookie') || ''
            },
            body: JSON.stringify({
                mode: audienceFilters.mode || 'filters',
                filters: audienceFilters.filters,
                segment_id: audienceFilters.segment_id,
                user_ids: audienceFilters.user_ids,
                include_all: true
            })
        });

        if (!audienceRes.ok) {
            return NextResponse.json({ error: 'Failed to resolve audience' }, { status: 500 });
        }

        const audienceData = await audienceRes.json();
        const recipients = audienceData.users || [];

        if (recipients.length === 0) {
            return NextResponse.json({ error: 'No recipients found for this campaign' }, { status: 400 });
        }

        // Update campaign status to 'sending'
        await (supabase as any)
            .from('marketing_campaigns')
            .update({ 
                status: 'sending',
                sent_at: new Date().toISOString(),
                total_recipients: recipients.length
            })
            .eq('id', campaignId);

        // Create send log entries for all recipients
        const sendLogs = recipients.map((r: any) => ({
            campaign_id: campaignId,
            company_id: orgId,
            recipient_phone: r.phone,
            recipient_name: r.name || null,
            organization_id: r.is_organization ? r.id : null,
            organization_name: r.org_name || null,
            organization_type: r.organization_type || null,
            status: 'queued',
            sent_by: user.id,
            created_at: new Date().toISOString()
        }));

        // Insert logs in batches
        const BATCH_SIZE = 500;
        for (let i = 0; i < sendLogs.length; i += BATCH_SIZE) {
            const batch = sendLogs.slice(i, i + BATCH_SIZE);
            await (supabase as any).from('marketing_send_logs').insert(batch);
        }

        // Get WhatsApp gateway URL from environment
        const gatewayUrl = process.env.WA_GATEWAY_URL;
        const gatewayKey = process.env.WA_GATEWAY_KEY;

        // Send messages in background (don't await)
        // The actual sending is done async to not block the response
        sendMessagesAsync(
            supabase,
            campaignId,
            campaign.message_body,
            recipients,
            gatewayUrl,
            gatewayKey,
            orgId
        );

        return NextResponse.json({ 
            success: true, 
            message: `Campaign launched! Sending to ${recipients.length} recipients.`,
            total_recipients: recipients.length
        });

    } catch (error) {
        console.error('Error launching campaign:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Async function to send messages without blocking
async function sendMessagesAsync(
    supabase: any,
    campaignId: string,
    messageBody: string,
    recipients: any[],
    gatewayUrl: string | undefined,
    gatewayKey: string | undefined,
    companyId: string
) {
    let sentCount = 0;
    let failedCount = 0;
    let deliveredCount = 0;

    for (const recipient of recipients) {
        try {
            // Update status to 'sending'
            await supabase
                .from('marketing_send_logs')
                .update({ 
                    status: 'sending',
                    sent_at: new Date().toISOString()
                })
                .eq('campaign_id', campaignId)
                .eq('recipient_phone', recipient.phone);

            // Personalize message
            const personalizedMessage = messageBody
                .replace(/{{name}}/gi, recipient.name || 'Customer')
                .replace(/{{org_name}}/gi, recipient.org_name || '')
                .replace(/{{phone}}/gi, recipient.phone || '');

            // Send via gateway
            if (gatewayUrl) {
                const sendRes = await fetch(`${gatewayUrl}/send-message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': gatewayKey || ''
                    },
                    body: JSON.stringify({
                        phone: recipient.phone,
                        message: personalizedMessage
                    })
                });

                if (sendRes.ok) {
                    const sendData = await sendRes.json();
                    
                    // Update log with success
                    await supabase
                        .from('marketing_send_logs')
                        .update({ 
                            status: sendData.delivered ? 'delivered' : 'delivered',
                            delivered_at: new Date().toISOString()
                        })
                        .eq('campaign_id', campaignId)
                        .eq('recipient_phone', recipient.phone);
                    
                    deliveredCount++;
                    sentCount++;
                } else {
                    const errorData = await sendRes.json().catch(() => ({}));
                    
                    // Update log with failure
                    await supabase
                        .from('marketing_send_logs')
                        .update({ 
                            status: 'failed',
                            error_message: errorData.error || 'Failed to send'
                        })
                        .eq('campaign_id', campaignId)
                        .eq('recipient_phone', recipient.phone);
                    
                    failedCount++;
                }
            } else {
                // No gateway configured, mark as failed
                await supabase
                    .from('marketing_send_logs')
                    .update({ 
                        status: 'failed',
                        error_message: 'WhatsApp gateway not configured'
                    })
                    .eq('campaign_id', campaignId)
                    .eq('recipient_phone', recipient.phone);
                
                failedCount++;
            }

            // Rate limiting - wait 100ms between messages
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
            console.error(`Error sending to ${recipient.phone}:`, error);
            
            await supabase
                .from('marketing_send_logs')
                .update({ 
                    status: 'failed',
                    error_message: error.message || 'Unknown error'
                })
                .eq('campaign_id', campaignId)
                .eq('recipient_phone', recipient.phone);
            
            failedCount++;
        }
    }

    // Update campaign status to completed
    const finalStatus = failedCount === recipients.length ? 'failed' : 'completed';
    await supabase
        .from('marketing_campaigns')
        .update({ 
            status: finalStatus,
            completed_at: new Date().toISOString(),
            sent_count: sentCount,
            delivered_count: deliveredCount,
            failed_count: failedCount
        })
        .eq('id', campaignId);
}
