/**
 * WhatsApp Gateway QR Code API
 * 
 * GET /api/settings/whatsapp/qr
 * Returns QR code for pairing (if waiting for QR)
 * 
 * Uses legacy gateway endpoint: GET /session/qr
 * Returns raw QR string + PNG base64 data URL for direct display
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

    // Call gateway QR endpoint (enriched response with PNG)
    const qrData = await callGateway(
      config.baseUrl,
      config.apiKey,
      'GET',
      '/session/qr',
      undefined,
      config.tenantId
    );

    return NextResponse.json({
      ok: qrData.ok !== false,
      qr: qrData.qr || null,
      qr_png_base64: qrData.qr_png_base64 || null,
      pairing_state: qrData.pairing_state,
      connected: qrData.connected || false,
      generated_at: qrData.generated_at || null,
      expires_in_sec: qrData.expires_in_sec || 0,
      tenant_id: qrData.tenant_id,
    });

  } catch (error: any) {
    console.error('Error getting WhatsApp QR:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Failed to get QR code'
    }, { status: 500 });
  }
}
