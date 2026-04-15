import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { getWhatsAppConfig, callGateway, logGatewayAction } from '@/app/api/settings/whatsapp/_utils';
import { normalizePhoneE164 } from '@/utils/phone';
import { buildDailyReportingData } from '@/lib/reporting/dailyReporting';

// Normalize phone number to E.164 format for Malaysian/Chinese numbers
function normalizePhone(phone: string): string {
  if (!phone) return '';
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If starts with +, assume already has country code
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Malaysian number: starts with 0, convert to +60
  if (cleaned.startsWith('0')) {
    return '+6' + cleaned; // 0192277233 -> +60192277233
  }

  // Chinese number: starts with 1 and is 11 digits
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return '+86' + cleaned;
  }

  // If starts with 60 (Malaysia without +)
  if (cleaned.startsWith('60') && cleaned.length >= 11) {
    return '+' + cleaned;
  }

  // If starts with 86 (China without +)
  if (cleaned.startsWith('86') && cleaned.length >= 13) {
    return '+' + cleaned;
  }

  return cleaned;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!userProfile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { message, number, test_user_id, test_phone, objective, reporting } = body;

    // Get WhatsApp config using shared utility
    const config = await getWhatsAppConfig(supabase, userProfile.organization_id);

    if (!config || !config.baseUrl) {
      return NextResponse.json({
        error: 'WhatsApp configuration not found. Please configure it in Settings > Notification Providers.'
      }, { status: 400 });
    }

    // Get target number: use provided number, or test_number from config
    const targetNumber = number || config.testNumber;
    if (!targetNumber) {
      return NextResponse.json({
        error: 'No test recipient configured. Please add test phone numbers in Settings > Notifications > WhatsApp > Testing tab.',
        code: 'NO_TEST_RECIPIENT'
      }, { status: 400 });
    }

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://serapod2u.com';
    const appUrl = `${appBaseUrl}/app`;

    // Resolve test user data if provided, or look up by target number
    let resolvedName = 'Test User';
    let resolvedCity = 'Kuala Lumpur';
    let resolvedPoints = '1000';

    let supabaseAdmin: any;
    try {
      supabaseAdmin = createAdminClient();
    } catch {
      supabaseAdmin = supabase;
    }

    // Determine which phone to use for user lookup
    const lookupPhone = test_phone || targetNumber;

    if (test_user_id || lookupPhone) {
      let userQuery = supabaseAdmin
        .from('users')
        .select('id, full_name, location, city, phone')
        .limit(1);

      let testUser = null;

      if (test_user_id) {
        // Lookup by user ID
        const { data } = await userQuery.eq('id', test_user_id).maybeSingle();
        testUser = data;
      } else if (lookupPhone) {
        // Lookup by phone using normalized format (consistent with preview API)
        const normalizedPhone = normalizePhone(lookupPhone);
        console.log('[Test Send] Looking up user by phone:', lookupPhone, '-> normalized:', normalizedPhone);

        // Try exact match first with normalized phone
        let { data: phoneMatch } = await supabaseAdmin
          .from('users')
          .select('id, full_name, location, city, phone')
          .eq('phone', normalizedPhone)
          .limit(1)
          .maybeSingle();

        // If no match, try alternative formats
        if (!phoneMatch) {
          const digitsOnly = lookupPhone.replace(/[^\d]/g, '');

          // Try with +60 prefix
          const { data: withCountryCode } = await supabaseAdmin
            .from('users')
            .select('id, full_name, location, city, phone')
            .eq('phone', '+60' + digitsOnly.replace(/^(60|0)/, ''))
            .limit(1)
            .maybeSingle();

          phoneMatch = withCountryCode;
        }

        // If still no match, try with local format (0...)
        if (!phoneMatch) {
          const digitsOnly = lookupPhone.replace(/[^\d]/g, '');
          const localFormat = '0' + digitsOnly.replace(/^(60|\+60)/, '').slice(-9);

          const { data: localMatch } = await supabaseAdmin
            .from('users')
            .select('id, full_name, location, city, phone')
            .eq('phone', localFormat)
            .limit(1)
            .maybeSingle();

          phoneMatch = localMatch;
        }

        testUser = phoneMatch;
        console.log('[Test Send] User lookup result:', testUser?.full_name || 'Not found');
      }

      if (testUser) {
        resolvedName = testUser.full_name || resolvedName;
        resolvedCity = (testUser.location || testUser.city || resolvedCity) as string;

        const { data: pointsData } = await supabaseAdmin
          .from('v_consumer_points_balance')
          .select('current_balance')
          .eq('user_id', testUser.id)
          .single();

        if (pointsData?.current_balance !== undefined && pointsData?.current_balance !== null) {
          resolvedPoints = Number(pointsData.current_balance || 0).toLocaleString();
        }
      }
    }

    // Replace variables with resolved data
    let processedMessage = (message || 'This is a test message from Serapod2U WhatsApp Broadcast')
      .replace(/{name}/g, resolvedName)
      .replace(/{city}/g, resolvedCity)
      .replace(/{points_balance}/g, resolvedPoints)
      .replace(/{short_link}/g, appUrl);

    // Use the same gateway call as the working test in Settings
    const result = await callGateway(
      config.baseUrl,
      config.apiKey,
      'POST',
      '/messages/send',
      {
        to: targetNumber,
        text: processedMessage,
      },
      config.tenantId
    );

    // Log the action
    await logGatewayAction(supabase, {
      action: 'marketing_test_send',
      userId: user.id,
      orgId: userProfile.organization_id,
      metadata: {
        recipient: targetNumber,
        result,
        tenantId: config.tenantId,
      },
    });

    const isSuccess = result?.success ?? result?.ok ?? false;
    const providerMessageId = result?.message_id || result?.provider_message_id || null;

    if (!isSuccess) {
      return NextResponse.json({
        error: result.error || 'Failed to send WhatsApp message via gateway'
      }, { status: 500 });
    }

    if (objective === 'Daily Reporting' && reporting?.enable_reply_action !== false) {
      const reportType = reporting?.report_type === 'weekly' ? 'weekly' : 'daily';
      const referenceDate = reporting?.referenceDate ? new Date(reporting.referenceDate) : new Date();
      const reportData = await buildDailyReportingData(supabaseAdmin, {
        reportType,
        referenceDate,
      });
      const normalizedRecipientPhone = normalizePhoneE164(targetNumber);
      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { data: campaignRow, error: campaignError } = await (supabaseAdmin as any)
        .from('marketing_campaigns')
        .insert({
          org_id: userProfile.organization_id,
          name: `[TEST] Daily Reporting ${new Date().toLocaleString('en-MY')}`,
          objective: 'Daily Reporting',
          status: 'archived',
          audience_filters: {
            mode: 'test_send',
            reporting: {
              report_type: reportType,
              enable_reply_action: true,
            },
            is_test: true,
          },
          estimated_count: 1,
          message_body: processedMessage,
          quiet_hours_enabled: false,
          total_recipients: 1,
          sent_count: 1,
          delivered_count: 1,
          created_by: user.id,
          sent_at: nowIso,
          completed_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id')
        .single();

      if (campaignError) {
        console.error('[Test Send] Failed to create Daily Reporting test campaign:', campaignError);
      } else {
        const { data: sendLogRow, error: sendLogError } = await (supabaseAdmin as any)
          .from('marketing_send_logs')
          .insert({
            campaign_id: campaignRow.id,
            company_id: userProfile.organization_id,
            recipient_phone: normalizedRecipientPhone,
            recipient_name: resolvedName,
            status: 'delivered',
            report_date: reportData.reportDateIso,
            report_type: reportData.reportType,
            message_snapshot: processedMessage,
            reply_enabled: true,
            sent_by: user.id,
            sent_at: nowIso,
            delivered_at: nowIso,
            provider_message_id: providerMessageId,
            provider_response: result,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select('id')
          .single();

        if (sendLogError) {
          console.error('[Test Send] Failed to create Daily Reporting test send log:', sendLogError);
        } else {
          const { error: sessionError } = await (supabaseAdmin as any)
            .from('marketing_report_sessions')
            .insert({
              campaign_id: campaignRow.id,
              send_log_id: sendLogRow.id,
              org_id: userProfile.organization_id,
              recipient_phone: normalizedRecipientPhone,
              recipient_name: resolvedName,
              report_date: reportData.reportDateIso,
              report_type: reportData.reportType,
              period_start: reportData.periodStartIso,
              period_end: reportData.periodEndIso,
              unique_customer_count: reportData.uniqueCustomers,
              unique_customer_details: reportData.uniqueCustomerDetails,
              message_snapshot: processedMessage,
              provider_message_id: providerMessageId,
              provider_chat_id: normalizedRecipientPhone,
              provider_context: {
                tenant_id: config.tenantId,
                source: 'marketing_test_send',
                is_test: true,
              },
              reply_enabled: true,
              last_detail_page_sent: 0,
              expires_at: expiresAtIso,
              last_outbound_message_id: providerMessageId,
              last_outbound_sent_at: nowIso,
              status: 'active',
              created_at: nowIso,
              updated_at: nowIso,
            });

          if (sessionError) {
            console.error('[Test Send] Failed to create Daily Reporting test session:', sessionError);
          }
        }
      }
    }

    return NextResponse.json({ success: true, sent_to: targetNumber });
  } catch (err: any) {
    console.error('Test send error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
