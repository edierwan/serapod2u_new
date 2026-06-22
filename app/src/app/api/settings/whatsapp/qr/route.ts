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

const normalizeQrImage = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const payload = value.trim();
  if (payload.startsWith('data:image/')) return payload;
  if (payload.startsWith('iVBOR')) return `data:image/png;base64,${payload}`;
  if (payload.startsWith('/9j/')) return `data:image/jpeg;base64,${payload}`;
  if (payload.startsWith('UklGR')) return `data:image/webp;base64,${payload}`;
  return null;
};

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
    const provider = request.nextUrl.searchParams.get('provider') || undefined;
    const config = await getWhatsAppConfig(supabase, userProfile.organization_id, provider);

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

    const rawQr = typeof qrData.qr === 'string' ? qrData.qr : null;
    const qrImage = normalizeQrImage(qrData.qr_png_base64) || normalizeQrImage(rawQr);

    return NextResponse.json({
      ok: qrData.ok !== false,
      qr: qrImage ? null : rawQr,
      qr_png_base64: qrImage,
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
