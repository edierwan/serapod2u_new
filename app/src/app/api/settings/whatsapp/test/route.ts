/**
 * WhatsApp Gateway Test Message API
 * 
 * POST /api/settings/whatsapp/test
 * Sends a test message via WhatsApp
 * 
 * Uses multi-tenant gateway endpoint: POST /tenants/{tenantId}/messages/send
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWhatsAppConfig, isAdminUser, callGateway, logGatewayAction } from '@/app/api/settings/whatsapp/_utils';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin permission
    const isAdmin = await isAdminUser(supabase, user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    // Get user's organization
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!userProfile?.organization_id) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Get WhatsApp config from DB
    const config = await getWhatsAppConfig(supabase, userProfile.organization_id);
    
    if (!config || !config.baseUrl) {
      return NextResponse.json({ 
        error: 'WhatsApp gateway not configured' 
      }, { status: 400 });
    }

    // Get body params
    let body: { to?: string; message?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body provided
    }

    // Use provided number or fall back to test number
    const recipientNumber = body.to || config.testNumber;
    
    if (!recipientNumber) {
      return NextResponse.json({ 
        error: 'No recipient number provided and no test number configured' 
      }, { status: 400 });
    }

    // Prepare message
    const message = body.message || `🧪 Test message from Serapod2u\n\nTimestamp: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\nIf you received this message, your WhatsApp gateway is working correctly! ✅`;

    // Call gateway tenant send endpoint
    const result = await callGateway(
      config.baseUrl, 
      config.apiKey, 
      'POST', 
      '/messages/send', 
      {
        to: recipientNumber,
        text: message,
      },
      config.tenantId
    );
    
    // Log the action
    await logGatewayAction(supabase, {
      action: 'send_test',
      userId: user.id,
      orgId: userProfile.organization_id,
      metadata: { 
        recipient: recipientNumber,
        result,
        tenantId: config.tenantId,
      },
    });
    
    return NextResponse.json({
      success: result.ok,
      message_id: result.jid,
      sent_to: recipientNumber,
      error: result.error,
    });

  } catch (error: any) {
    console.error('Error sending test message:', error);
    return NextResponse.json({ 
      success: false,
      error: error.message || 'Failed to send test message' 
    }, { status: 500 });
  }
}
