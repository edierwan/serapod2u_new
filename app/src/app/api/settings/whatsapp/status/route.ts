/**
 * WhatsApp Gateway Status API
 * 
 * GET /api/settings/whatsapp/status
 * Returns the current WhatsApp gateway connection status
 * 
 * Uses multi-tenant gateway endpoint: GET /tenants/{tenantId}/status
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWhatsAppConfig, isAdminUser, callGateway } from '@/app/api/settings/whatsapp/_utils';

export async function GET(request: NextRequest) {
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
        configured: false,
        connected: false,
        pairing_state: 'not_configured',
        phone_number: null,
        push_name: null,
        last_connected_at: null,
        last_error: 'WhatsApp gateway not configured',
      });
    }

    // Call gateway tenant status endpoint
    try {
      const gatewayStatus = await callGateway(
        config.baseUrl, 
        config.apiKey, 
        'GET', 
        '/status',
        undefined,
        config.tenantId
      );
      
      return NextResponse.json({
        configured: true,
        connected: gatewayStatus.connected,
        pairing_state: gatewayStatus.pairing_state,
        phone_number: gatewayStatus.phone_number,
        push_name: gatewayStatus.push_name,
        last_connected_at: gatewayStatus.last_connected_at,
        last_error: gatewayStatus.last_error,
        has_qr: gatewayStatus.has_qr,
        tenant_id: gatewayStatus.tenant_id,
      });
    } catch (gatewayError: any) {
      // Gateway unreachable
      return NextResponse.json({
        configured: true,
        connected: false,
        pairing_state: 'gateway_unreachable',
        phone_number: null,
        push_name: null,
        last_connected_at: null,
        last_error: `Gateway unreachable: ${gatewayError.message}`,
        gateway_url: config.baseUrl,
      });
    }

  } catch (error: any) {
    console.error('Error getting WhatsApp status:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
