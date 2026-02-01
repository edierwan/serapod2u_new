/**
 * WhatsApp Gateway QR Code API
 * 
 * GET /api/settings/whatsapp/qr
 * Returns QR code for pairing (if waiting for QR)
 * 
 * Uses multi-tenant gateway endpoint: GET /tenants/{tenantId}/session/qr
 * Returns raw QR string (not data URL) - client renders with qrcode library
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
        error: 'WhatsApp gateway not configured'
      }, { status: 400 });
    }

    // Call gateway tenant QR endpoint
    const qrData = await callGateway(
      config.baseUrl,
      config.apiKey,
      'GET',
      '/session/qr',
      undefined,
      config.tenantId
    );

    return NextResponse.json({
      ok: qrData.ok,
      qr: qrData.qr,
      pairing_state: qrData.pairing_state,
      expires_in_sec: qrData.expires_in_sec,
      tenant_id: qrData.tenant_id,
    });

  } catch (error: any) {
    console.error('Error getting WhatsApp QR:', error);
    return NextResponse.json({
      error: error.message || 'Failed to get QR code'
    }, { status: 500 });
  }
}
