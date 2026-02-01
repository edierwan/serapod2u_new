/**
 * WhatsApp Gateway Reset Session API
 * 
 * POST /api/settings/whatsapp/reset
 * Resets the WhatsApp session to change phone number
 * 
 * Uses multi-tenant gateway endpoint: POST /tenants/{tenantId}/session/reset
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

    // Call gateway tenant reset endpoint
    const result = await callGateway(
      config.baseUrl,
      config.apiKey,
      'POST',
      '/session/reset',
      undefined,
      config.tenantId
    );

    // Log the action
    await logGatewayAction(supabase, {
      action: 'reset',
      userId: user.id,
      orgId: userProfile.organization_id,
      metadata: { result, tenantId: config.tenantId },
    });

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error resetting WhatsApp session:', error);
    return NextResponse.json({
      error: error.message || 'Failed to reset session'
    }, { status: 500 });
  }
}
