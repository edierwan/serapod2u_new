/**
 * WhatsApp Gateway Reconnect API
 * 
 * POST /api/settings/whatsapp/reconnect
 * Attempts to reconnect without resetting session
 * 
 * Note: For multi-tenant gateway, reconnect triggers status check which
 * lazy-initializes the socket. This endpoint fetches status to trigger reconnection.
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

    // For multi-tenant gateway, calling status endpoint will trigger lazy socket creation
    // which effectively acts as a reconnect
    const result = await callGateway(
      config.baseUrl,
      config.apiKey,
      'GET',
      '/status',
      undefined,
      config.tenantId
    );

    // Log the action
    await logGatewayAction(supabase, {
      action: 'reconnect',
      userId: user.id,
      orgId: userProfile.organization_id,
      metadata: { result, tenantId: config.tenantId },
    });

    return NextResponse.json({
      ok: result.ok,
      pairing_state: result.pairing_state,
      connected: result.connected,
    });

  } catch (error: any) {
    console.error('Error reconnecting WhatsApp:', error);
    return NextResponse.json({
      error: error.message || 'Failed to reconnect'
    }, { status: 500 });
  }
}
