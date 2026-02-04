import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils';

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
        const audienceUrl = `${request.nextUrl.origin}/api/wa/marketing/audience/resolve`;
        const audienceRes = await fetch(audienceUrl, {
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
                overrides: audienceFilters.overrides,
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

        let supabaseAdmin: any;
        try {
            supabaseAdmin = createAdminClient();
        } catch {
            supabaseAdmin = supabase;
        }

        // Insert logs in batches
        const BATCH_SIZE = 500;
        for (let i = 0; i < sendLogs.length; i += BATCH_SIZE) {
            const batch = sendLogs.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await (supabaseAdmin as any).from('marketing_send_logs').insert(batch);
            if (insertError) {
                console.error('Error inserting send logs:', insertError);
                await (supabase as any)
                    .from('marketing_campaigns')
                    .update({ status: 'failed' })
                    .eq('id', campaignId);
                return NextResponse.json({ error: 'Failed to create delivery logs' }, { status: 500 });
            }
        }

        // Get WhatsApp config using shared utility (same as test-send)
        const waConfig = await getWhatsAppConfig(supabase, orgId);
        if (!waConfig || !waConfig.baseUrl) {
            await (supabase as any)
                .from('marketing_campaigns')
                .update({ status: 'failed' })
                .eq('id', campaignId);
            return NextResponse.json({
                error: 'WhatsApp configuration not found. Please configure it in Settings > Notification Providers.'
            }, { status: 400 });
        }

        // Send messages in background (don't await)
        // The actual sending is done async to not block the response
        sendMessagesAsync(
            supabaseAdmin,
            campaignId,
            campaign.message_body,
            recipients,
            waConfig,
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
    waConfig: { baseUrl: string; apiKey: string | undefined; tenantId: string },
    companyId: string
) {
    let sentCount = 0;
    let failedCount = 0;
    let deliveredCount = 0;

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://serapod2u.com';
    const appUrl = `${appBaseUrl}/app`;

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

            // Get user's points balance if available
            let pointsBalance = '0';
            if (recipient.user_id) {
                const { data: pointsData } = await supabase
                    .from('v_consumer_points_balance')
                    .select('current_balance')
                    .eq('user_id', recipient.user_id)
                    .single();
                if (pointsData?.current_balance !== undefined && pointsData?.current_balance !== null) {
                    pointsBalance = Number(pointsData.current_balance || 0).toLocaleString();
                }
            }

            // Personalize message - use single braces {name} to match templates
            const personalizedMessage = messageBody
                .replace(/{name}/g, recipient.name || 'Customer')
                .replace(/{city}/g, recipient.city || recipient.location || '')
                .replace(/{points_balance}/g, pointsBalance)
                .replace(/{short_link}/g, appUrl)
                .replace(/{org_name}/g, recipient.org_name || '')
                .replace(/{phone}/g, recipient.phone || '');

            // Send via gateway using shared utility (same as test-send)
            const phone = recipient.phone.replace(/[^\d]/g, '');

            const result = await callGateway(
                waConfig.baseUrl,
                waConfig.apiKey,
                'POST',
                '/messages/send',
                {
                    to: phone,
                    text: personalizedMessage,
                },
                waConfig.tenantId
            );

            if (result.ok !== false && !result.error) {
                // Update log with success
                await supabase
                    .from('marketing_send_logs')
                    .update({
                        status: 'delivered',
                        delivered_at: new Date().toISOString()
                    })
                    .eq('campaign_id', campaignId)
                    .eq('recipient_phone', recipient.phone);

                deliveredCount++;
                sentCount++;
            } else {
                // Update log with failure
                await supabase
                    .from('marketing_send_logs')
                    .update({
                        status: 'failed',
                        error_message: result.error || 'Failed to send'
                    })
                    .eq('campaign_id', campaignId)
                    .eq('recipient_phone', recipient.phone);

                failedCount++;
            }

            const processedCount = sentCount + failedCount;
            if (processedCount % 5 === 0 || processedCount === recipients.length) {
                await supabase
                    .from('marketing_campaigns')
                    .update({
                        sent_count: sentCount,
                        delivered_count: deliveredCount,
                        failed_count: failedCount
                    })
                    .eq('id', campaignId);
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

            const processedCount = sentCount + failedCount;
            if (processedCount % 5 === 0 || processedCount === recipients.length) {
                await supabase
                    .from('marketing_campaigns')
                    .update({
                        sent_count: sentCount,
                        delivered_count: deliveredCount,
                        failed_count: failedCount
                    })
                    .eq('id', campaignId);
            }
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
