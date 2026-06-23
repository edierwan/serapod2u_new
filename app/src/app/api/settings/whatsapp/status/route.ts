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
import { getWhatsAppConfig, isAdminUser, isBaileysProvider, callGateway } from '@/app/api/settings/whatsapp/_utils';

async function hasGatewayQr(config: { baseUrl: string; apiKey: string | undefined; tenantId: string }) {
  try {
    const qrStatus = await callGateway(
      config.baseUrl,
      config.apiKey,
      'GET',
      '/session/qr',
      undefined,
      config.tenantId
    );

    return Boolean(qrStatus?.available || qrStatus?.qr || qrStatus?.qr_png_base64);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
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

    if (!config) {
      return NextResponse.json({
        configured: false,
        connected: false,
        pairing_state: 'not_configured',
        phone_number: null,
        push_name: null,
        last_connected_at: null,
        last_error: provider ? 'WhatsApp provider not configured' : 'No default WhatsApp provider configured',
      });
    }

    const providerLabels: Record<string, string> = {
      whatsapp_business: 'WhatsApp Business API', baileys: 'Baileys — Hostinger',
      baileys_home: 'Baileys — Home', twilio: 'Twilio', messagebird: 'MessageBird',
    };
    const providerMetadata = { provider_name: providerLabels[config.providerName] || config.providerName, provider_key: config.providerName, provider_type: config.providerType, is_default: config.isDefault };

    if (!isBaileysProvider(config.providerName)) {
      if (config.providerName === 'whatsapp_business') {
        const phoneNumberId = String(config.publicConfig.phone_number_id || '').trim();
        const accessToken = String(config.sensitiveConfig.access_token || '').trim();
        if (!phoneNumberId || !accessToken) return NextResponse.json({ configured: true, connected: false, pairing_state: 'incomplete_configuration', last_error: 'Meta provider configuration is incomplete', ...providerMetadata });
        try {
          const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          return NextResponse.json({ configured: true, connected: response.ok, pairing_state: response.ok ? 'connected' : 'disconnected', phone_number: payload.display_phone_number || null, last_error: response.ok ? null : payload?.error?.message || `HTTP ${response.status}`, ...providerMetadata }, { headers: { 'Cache-Control': 'no-store' } });
        } catch (error: any) {
          return NextResponse.json({ configured: true, connected: false, pairing_state: 'gateway_unreachable', last_error: error.message, ...providerMetadata });
        }
      }
      return NextResponse.json({ configured: true, connected: false, pairing_state: 'adapter_unavailable', last_error: `No status adapter configured for ${config.providerName}`, ...providerMetadata });
    }

    if (!config.baseUrl) return NextResponse.json({ configured: true, connected: false, pairing_state: 'incomplete_configuration', last_error: 'Gateway URL is missing', ...providerMetadata });

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

      // Map gateway response fields:
      // getouch-wa returns { state, authenticated, phone, uptime, ... }
      // baileys-gateway returns { connected, pairing_state, phone_number, ... }
      const isGetouch = gatewayStatus.state !== undefined;
      const connected = isGetouch
        ? gatewayStatus.state === 'open' && gatewayStatus.authenticated === true
        : !!gatewayStatus.connected;
      const phoneNumber = isGetouch
        ? gatewayStatus.phone || null
        : gatewayStatus.phone_number || null;
      const qrAvailable = isGetouch && !connected
        ? await hasGatewayQr(config)
        : Boolean(gatewayStatus.has_qr);
      const pairingState = isGetouch
        ? (connected ? 'connected' : qrAvailable ? 'waiting_qr' : gatewayStatus.state || 'disconnected')
        : gatewayStatus.pairing_state;

      return NextResponse.json({
        configured: true,
        connected,
        pairing_state: pairingState,
        phone_number: phoneNumber,
        push_name: gatewayStatus.push_name || null,
        last_connected_at: gatewayStatus.last_connected_at || null,
        last_error: gatewayStatus.last_error || null,
        last_disconnect_code: gatewayStatus.last_disconnect_code || null,
        last_disconnect_reason: gatewayStatus.last_disconnect_reason || null,
        has_qr: qrAvailable,
        tenant_id: gatewayStatus.tenant_id,
        ...providerMetadata,
      }, { headers: { 'Cache-Control': 'no-store' } });
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
        ...providerMetadata,
      });
    }

  } catch (error: any) {
    console.error('Error getting WhatsApp status:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
