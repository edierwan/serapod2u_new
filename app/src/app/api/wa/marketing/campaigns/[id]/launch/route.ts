import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils';
import { normalizePhoneE164 } from '@/utils/phone';
import {
    buildDailyReportingData,
    normalizeDailyReportingConfig,
    renderDailyReportingMessage,
} from '@/lib/reporting/dailyReporting';

function normalizeUuid(value: unknown) {
    if (typeof value !== 'string') {
        return value ?? null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.length >= 20 ? trimmed : null;
}

function normalizeIdArray(values: unknown) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}

/** Structured log helper for campaign launch observability */
function logLaunch(level: 'info' | 'warn' | 'error', message: string, ctx: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), scope: 'campaign_launch', message, ...ctx };
    if (level === 'error') console.error(JSON.stringify(entry));
    else if (level === 'warn') console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
}

/** Persist a launch failure on the campaign row so it's visible in DB and UI */
async function markLaunchFailed(
    supabase: any,
    campaignId: string,
    errorCode: string,
    errorMessage: string,
) {
    await supabase
        .from('marketing_campaigns')
        .update({
            status: 'launch_failed',
            launch_error_code: errorCode,
            launch_error_message: errorMessage,
            last_transition_at: new Date().toISOString(),
        })
        .eq('id', campaignId);
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const launchStartedAt = Date.now();
    let campaignId: string | undefined;
    let userId: string | undefined;
    let orgId: string | undefined;

    try {
        ({ id: campaignId } = await params);
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        userId = user.id;

        // Get user's org_id and profile info
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id, full_name')
            .eq('id', user.id)
            .single();

        orgId = userProfile?.organization_id;
        if (!orgId) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 });
        }

        logLaunch('info', 'Launch requested', { campaign_id: campaignId, user_id: userId, org_id: orgId });

        // Get the campaign
        const { data: campaign, error: campaignError } = await (supabase as any)
            .from('marketing_campaigns')
            .select('*')
            .eq('id', campaignId)
            .single();

        if (campaignError || !campaign) {
            logLaunch('warn', 'Campaign not found', { campaign_id: campaignId, error: campaignError?.message });
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }

        // Idempotency: block if already sending or completed
        if (campaign.status === 'sending') {
            logLaunch('warn', 'Idempotency guard: already sending', { campaign_id: campaignId });
            return NextResponse.json({
                success: true,
                message: 'Campaign is already sending.',
                total_recipients: campaign.total_recipients || campaign.estimated_count,
                campaign_id: campaignId,
            });
        }
        if (campaign.status === 'completed') {
            logLaunch('warn', 'Idempotency guard: already completed', { campaign_id: campaignId });
            return NextResponse.json({
                success: true,
                message: 'Campaign has already been sent.',
                total_recipients: campaign.total_recipients || campaign.estimated_count,
                campaign_id: campaignId,
            });
        }

        // Only allow launch from draft, scheduled, or launch_failed
        const launchableStatuses = ['draft', 'scheduled', 'launch_failed'];
        if (!launchableStatuses.includes(campaign.status)) {
            logLaunch('warn', 'Invalid status for launch', { campaign_id: campaignId, status: campaign.status });
            return NextResponse.json({
                error: `Cannot launch campaign in "${campaign.status}" status`,
                campaign_id: campaignId,
            }, { status: 400 });
        }

        const isDailyReportingCampaign = campaign.objective === 'Daily Reporting';
        const reportingConfig = normalizeDailyReportingConfig(campaign.audience_filters?.reporting);
        const reportReferenceDate = campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date();
        const dailyReportingData = isDailyReportingCampaign
            ? await buildDailyReportingData(supabase as any, {
                reportType: reportingConfig.reportType,
                referenceDate: reportReferenceDate,
            })
            : null;
        const resolvedMessageBody = dailyReportingData
            ? renderDailyReportingMessage(dailyReportingData, reportingConfig.enableReplyAction)
            : campaign.message_body;

        // ── Phase 1: Resolve audience server-side ──────────────────────
        const audienceFilters = campaign.audience_filters || {};
        const audienceUrl = `${request.nextUrl.origin}/api/wa/marketing/audience/resolve`;
        let audienceRes: Response;
        try {
            audienceRes = await fetch(audienceUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': request.headers.get('cookie') || ''
                },
                body: JSON.stringify({
                    mode: audienceFilters.mode || 'filters',
                    filters: audienceFilters.filters,
                    segment_id: normalizeUuid(audienceFilters.segment_id),
                    user_ids: normalizeIdArray(audienceFilters.user_ids),
                    overrides: audienceFilters.overrides,
                    include_all: true
                })
            });
        } catch (fetchErr: any) {
            logLaunch('error', 'Audience resolution network error', {
                campaign_id: campaignId, error: fetchErr.message,
            });
            await markLaunchFailed(supabase, campaignId, 'AUDIENCE_NETWORK_ERROR', fetchErr.message);
            return NextResponse.json({
                error: 'Failed to resolve audience (network error)',
                code: 'AUDIENCE_NETWORK_ERROR',
                campaign_id: campaignId,
                retryable: true,
            }, { status: 502 });
        }

        if (!audienceRes.ok) {
            const errBody = await audienceRes.text().catch(() => 'unknown');
            logLaunch('error', 'Audience resolution failed', {
                campaign_id: campaignId, status: audienceRes.status, body: errBody,
            });
            await markLaunchFailed(supabase, campaignId, 'AUDIENCE_RESOLVE_FAILED', `HTTP ${audienceRes.status}`);
            return NextResponse.json({
                error: 'Failed to resolve audience',
                code: 'AUDIENCE_RESOLVE_FAILED',
                campaign_id: campaignId,
                retryable: true,
            }, { status: 500 });
        }

        const audienceData = await audienceRes.json();
        const recipients = audienceData.users || [];

        if (recipients.length === 0) {
            logLaunch('warn', 'No recipients resolved', { campaign_id: campaignId, audienceFilters });
            await markLaunchFailed(supabase, campaignId, 'NO_RECIPIENTS', 'Audience resolved to 0 recipients');
            return NextResponse.json({
                error: 'No recipients found for this campaign',
                code: 'NO_RECIPIENTS',
                campaign_id: campaignId,
                retryable: false,
            }, { status: 400 });
        }

        logLaunch('info', 'Audience resolved', {
            campaign_id: campaignId, resolved_count: recipients.length,
            estimated_count: campaign.estimated_count,
        });

        // ── Phase 2: Validate WhatsApp config BEFORE touching state ───
        const waConfig = await getWhatsAppConfig(supabase, orgId);
        if (!waConfig || !waConfig.baseUrl) {
            logLaunch('error', 'WhatsApp config missing', { campaign_id: campaignId, org_id: orgId });
            await markLaunchFailed(supabase, campaignId, 'WA_CONFIG_MISSING', 'WhatsApp configuration not found');
            return NextResponse.json({
                error: 'WhatsApp configuration not found. Please configure it in Settings > Notification Providers.',
                code: 'WA_CONFIG_MISSING',
                campaign_id: campaignId,
                retryable: false,
            }, { status: 400 });
        }

        // ── Phase 3: Transition to sending & persist recipient count ──
        const now = new Date().toISOString();
        const { error: statusError } = await (supabase as any)
            .from('marketing_campaigns')
            .update({
                status: 'sending',
                sent_at: now,
                launched_at: now,
                total_recipients: recipients.length,
                launch_error_code: null,
                launch_error_message: null,
                last_transition_at: now,
            })
            .eq('id', campaignId);

        if (statusError) {
            logLaunch('error', 'Failed to transition to sending', {
                campaign_id: campaignId, error: statusError.message,
            });
            return NextResponse.json({
                error: 'Failed to update campaign status',
                code: 'STATUS_TRANSITION_FAILED',
                campaign_id: campaignId,
                retryable: true,
            }, { status: 500 });
        }

        // ── Phase 4: Create send log entries ──────────────────────────
        const sendLogs = recipients.map((r: any) => ({
            campaign_id: campaignId,
            company_id: orgId,
            recipient_phone: r.phone,
            recipient_name: r.name || null,
            organization_id: r.is_organization ? r.id : null,
            organization_name: r.org_name || null,
            organization_type: r.organization_type || null,
            report_date: dailyReportingData?.reportDateIso || null,
            report_type: dailyReportingData?.reportType || null,
            message_snapshot: resolvedMessageBody,
            reply_enabled: isDailyReportingCampaign ? reportingConfig.enableReplyAction : false,
            status: 'queued',
            sent_by: user.id,
            created_at: now,
        }));

        let supabaseAdmin: any;
        try {
            supabaseAdmin = createAdminClient();
        } catch {
            supabaseAdmin = supabase;
        }

        const BATCH_SIZE = 500;
        const insertedSendLogs: Array<{ id: string; recipient_phone: string; recipient_name: string | null }> = [];
        for (let i = 0; i < sendLogs.length; i += BATCH_SIZE) {
            const batch = sendLogs.slice(i, i + BATCH_SIZE);
            const { data: batchRows, error: insertError } = await (supabaseAdmin as any)
                .from('marketing_send_logs')
                .insert(batch)
                .select('id, recipient_phone, recipient_name');
            if (insertError) {
                logLaunch('error', 'Send log insert failed', {
                    campaign_id: campaignId, error: insertError.message, batch_index: i,
                });
                await markLaunchFailed(supabase, campaignId, 'SEND_LOG_INSERT_FAILED', insertError.message);
                return NextResponse.json({
                    error: 'Failed to create delivery logs',
                    code: 'SEND_LOG_INSERT_FAILED',
                    campaign_id: campaignId,
                    retryable: true,
                }, { status: 500 });
            }

            insertedSendLogs.push(...((batchRows || []) as Array<{ id: string; recipient_phone: string; recipient_name: string | null }>));
        }

        // ── Phase 5: Daily Reporting sessions (if applicable) ─────────
        if (isDailyReportingCampaign && dailyReportingData && reportingConfig.enableReplyAction) {
            const sessionRows = insertedSendLogs.map((log) => ({
                campaign_id: campaignId,
                send_log_id: log.id,
                org_id: orgId,
                recipient_phone: normalizePhoneE164(log.recipient_phone || ''),
                recipient_name: log.recipient_name || null,
                report_date: dailyReportingData.reportDateIso,
                report_type: dailyReportingData.reportType,
                period_start: dailyReportingData.periodStartIso,
                period_end: dailyReportingData.periodEndIso,
                unique_customer_count: dailyReportingData.uniqueCustomers,
                unique_customer_details: dailyReportingData.uniqueCustomerDetails,
                message_snapshot: resolvedMessageBody,
                provider_context: {
                    report_type: dailyReportingData.reportType,
                },
                reply_enabled: true,
                last_detail_page_sent: 0,
                status: 'active',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                created_at: now,
                updated_at: now,
            }));

            for (let i = 0; i < sessionRows.length; i += BATCH_SIZE) {
                const batch = sessionRows.slice(i, i + BATCH_SIZE);
                const { error: sessionError } = await (supabaseAdmin as any)
                    .from('marketing_report_sessions')
                    .insert(batch);

                if (sessionError) {
                    logLaunch('error', 'Report session insert failed', {
                        campaign_id: campaignId, error: sessionError.message,
                    });
                    await markLaunchFailed(supabase, campaignId, 'REPORT_SESSION_INSERT_FAILED', sessionError.message);
                    return NextResponse.json({
                        error: 'Failed to prepare Daily Reporting reply sessions',
                        code: 'REPORT_SESSION_INSERT_FAILED',
                        campaign_id: campaignId,
                        retryable: true,
                    }, { status: 500 });
                }
            }
        }

        // ── Phase 6: Dispatch async sending ───────────────────────────
        logLaunch('info', 'Dispatching async send', {
            campaign_id: campaignId,
            recipient_count: recipients.length,
            launch_duration_ms: Date.now() - launchStartedAt,
        });

        sendMessagesAsync(
            supabaseAdmin,
            campaignId,
            resolvedMessageBody,
            recipients,
            waConfig,
            orgId,
            isDailyReportingCampaign
        );

        return NextResponse.json({
            success: true,
            message: `Campaign launched! Sending to ${recipients.length} recipients.`,
            total_recipients: recipients.length,
            campaign_id: campaignId,
        });

    } catch (error: any) {
        logLaunch('error', 'Unhandled launch error', {
            campaign_id: campaignId,
            user_id: userId,
            org_id: orgId,
            error: error.message,
            stack: error.stack?.slice(0, 500),
        });

        // If we have a campaign id, mark it as launch_failed
        if (campaignId) {
            try {
                const supabase = await createClient();
                await markLaunchFailed(supabase, campaignId, 'UNHANDLED_ERROR', error.message || 'Internal server error');
            } catch { /* best effort */ }
        }

        return NextResponse.json({
            error: 'Internal server error',
            code: 'UNHANDLED_ERROR',
            campaign_id: campaignId,
            retryable: true,
        }, { status: 500 });
    }
}

// Async function to send messages without blocking the HTTP response
async function sendMessagesAsync(
    supabase: any,
    campaignId: string,
    messageBody: string,
    recipients: any[],
    waConfig: { baseUrl: string; apiKey: string | undefined; tenantId: string },
    companyId: string,
    skipPersonalization: boolean = false,
) {
    let sentCount = 0;
    let failedCount = 0;
    let deliveredCount = 0;

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://serapod2u.com';
    const appUrl = `${appBaseUrl}/app`;

    logLaunch('info', 'Async send loop started', {
        campaign_id: campaignId, total: recipients.length,
    });

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
            const personalizedMessage = skipPersonalization
                ? messageBody
                : messageBody
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

            const providerMessageId = result?.message_id || result?.provider_message_id || null;

            if (result.ok !== false && !result.error) {
                // Update log with success
                await supabase
                    .from('marketing_send_logs')
                    .update({
                        status: 'delivered',
                        provider_message_id: providerMessageId,
                        provider_response: result,
                        delivered_at: new Date().toISOString()
                    })
                    .eq('campaign_id', campaignId)
                    .eq('recipient_phone', recipient.phone);

                if (skipPersonalization) {
                    await supabase
                        .from('marketing_report_sessions')
                        .update({
                            provider_message_id: providerMessageId,
                            provider_chat_id: normalizePhoneE164(recipient.phone),
                            last_outbound_message_id: providerMessageId,
                            last_outbound_sent_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('campaign_id', campaignId)
                        .eq('recipient_phone', normalizePhoneE164(recipient.phone));
                }

                deliveredCount++;
                sentCount++;
            } else {
                // Update log with failure
                await supabase
                    .from('marketing_send_logs')
                    .update({
                        status: 'failed',
                        provider_message_id: providerMessageId,
                        provider_response: result,
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
                        failed_count: failedCount,
                        last_transition_at: new Date().toISOString(),
                    })
                    .eq('id', campaignId);
            }

            // Rate limiting - wait 100ms between messages
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
            logLaunch('error', 'Send to recipient failed', {
                campaign_id: campaignId,
                recipient_phone: recipient.phone,
                error: error.message,
            });

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
                        failed_count: failedCount,
                        last_transition_at: new Date().toISOString(),
                    })
                    .eq('id', campaignId);
            }
        }
    }

    // Update campaign status to completed
    const finalStatus = failedCount === recipients.length ? 'failed' : 'completed';
    const now = new Date().toISOString();
    await supabase
        .from('marketing_campaigns')
        .update({
            status: finalStatus,
            completed_at: now,
            sent_count: sentCount,
            delivered_count: deliveredCount,
            failed_count: failedCount,
            last_transition_at: now,
        })
        .eq('id', campaignId);

    logLaunch('info', 'Async send loop completed', {
        campaign_id: campaignId,
        final_status: finalStatus,
        sent: sentCount,
        delivered: deliveredCount,
        failed: failedCount,
    });
}
