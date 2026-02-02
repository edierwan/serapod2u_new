import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getWhatsAppConfig, callGateway, logGatewayAction } from '@/app/api/settings/whatsapp/_utils';

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
    const { message, number } = body;
    
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
    
    // Replace variables with sample data if present in message
    let processedMessage = (message || 'This is a test message from Serapod2U WhatsApp Broadcast')
        .replace(/{name}/g, 'Test User')
        .replace(/{city}/g, 'Kuala Lumpur')
        .replace(/{points_balance}/g, '1000')
        .replace(/{short_link}/g, 'https://bit.ly/test');

    const phone = targetNumber.replace(/[^\d]/g, '');

    // Use the same gateway call as the working test in Settings
    const result = await callGateway(
      config.baseUrl,
      config.apiKey,
      'POST',
      '/messages/send',
      {
        to: phone,
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
        recipient: phone,
        result,
        tenantId: config.tenantId,
      },
    });

    if (!result.ok) {
      return NextResponse.json({ 
        error: result.error || 'Failed to send WhatsApp message via gateway' 
      }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, sent_to: targetNumber });
  } catch (err: any) {
    console.error('Test send error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
