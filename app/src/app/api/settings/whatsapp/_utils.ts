/**
 * WhatsApp Gateway API Utilities
 * 
 * Shared utilities for WhatsApp gateway API routes
 * Updated for multi-tenant gateway endpoints
 */

import { SupabaseClient } from '@supabase/supabase-js';

// Default tenant ID for Serapod2u
const DEFAULT_TENANT_ID = 'serapod2u';

// All Baileys provider variants
const BAILEYS_PROVIDERS = ['baileys', 'baileys_home'] as const;

/** Check if a provider name is a Baileys variant */
export function isBaileysProvider(name: string | undefined | null): boolean {
  return BAILEYS_PROVIDERS.includes(name as any);
}

/**
 * Get WhatsApp configuration from database
 * @param providerName - specific provider to query, or undefined to find any active baileys provider
 */
export async function getWhatsAppConfig(supabase: SupabaseClient, orgId: string, providerName?: string) {
  let query = supabase
    .from('notification_provider_configs')
    .select('id, provider_name, is_active, is_default, config_public, config_encrypted')
    .eq('org_id', orgId)
    .eq('channel', 'whatsapp');

  if (providerName) {
    query = query.eq('provider_name', providerName);
  } else {
    query = query.eq('is_default', true).eq('is_active', true);
  }

  const { data, error } = await query.limit(1).single();

  if (error || !data) {
    return null;
  }

  const publicConfig = data.config_public || {};
  let sensitiveConfig: Record<string, any> = {};

  if (data.config_encrypted) {
    try {
      // Note: In production, this should use proper decryption
      // For now, assuming config_encrypted stores JSON directly
      sensitiveConfig = typeof data.config_encrypted === 'string'
        ? JSON.parse(data.config_encrypted)
        : data.config_encrypted;
    } catch (e) {
      console.error("Failed to parse whatsapp config_encrypted", e);
    }
  }

  return {
    id: data.id,
    providerName: data.provider_name,
    providerType: isBaileysProvider(data.provider_name)
      ? 'Baileys Gateway'
      : data.provider_name === 'whatsapp_business'
        ? 'Meta Cloud API'
        : data.provider_name === 'twilio'
          ? 'Twilio WhatsApp API'
          : data.provider_name === 'messagebird' ? 'MessageBird Conversations API' : data.provider_name,
    isDefault: !!data.is_default,
    baseUrl: publicConfig.base_url,
    apiKey: sensitiveConfig.api_key,
    testNumber: publicConfig.test_number,
    tenantId: publicConfig.tenant_id || DEFAULT_TENANT_ID,
    publicConfig,
    sensitiveConfig,
  };
}

export const DEFAULT_WHATSAPP_PROVIDER_ERROR = 'No default WhatsApp provider is configured. Select an enabled provider in Notification Providers and set it as default.';

export async function requireDefaultWhatsAppConfig(supabase: SupabaseClient, orgId: string) {
  const config = await getWhatsAppConfig(supabase, orgId);
  if (!config) throw new Error(DEFAULT_WHATSAPP_PROVIDER_ERROR);
  return config;
}

export async function sendWhatsAppMessage(
  supabase: SupabaseClient,
  orgId: string,
  input: { to: string; text: string; imageUrl?: string; caption?: string }
) {
  const config = await requireDefaultWhatsAppConfig(supabase, orgId);

  if (isBaileysProvider(config.providerName)) {
    if (!config.baseUrl) throw new Error(`Default WhatsApp provider ${config.providerName} is missing its gateway URL.`);
    const endpoint = input.imageUrl ? '/messages/send-image' : '/messages/send';
    const body = input.imageUrl
      ? { to: input.to, imageUrl: input.imageUrl, caption: input.caption || input.text }
      : { to: input.to, text: input.text };
    const response = await callGateway(config.baseUrl, config.apiKey, 'POST', endpoint, body, config.tenantId);
    return { providerName: config.providerName, providerType: config.providerType, response };
  }

  if (config.providerName === 'whatsapp_business') {
    const phoneNumberId = String(config.publicConfig.phone_number_id || '').trim();
    const accessToken = String(config.sensitiveConfig.access_token || '').trim();
    if (!phoneNumberId || !accessToken) throw new Error('Default Meta WhatsApp provider is missing Phone Number ID or access token.');
    const messagePayload = input.imageUrl
      ? { type: 'image', image: { link: input.imageUrl, caption: input.caption || input.text } }
      : { type: 'text', text: { preview_url: false, body: input.text } };
    const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: input.to.replace(/\D/g, ''),
        ...messagePayload,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Meta Cloud API returned HTTP ${response.status}`);
    return { providerName: config.providerName, providerType: config.providerType, response: { ...payload, success: true, messageId: payload?.messages?.[0]?.id || null } };
  }

  if (config.providerName === 'twilio') {
    const accountSid = String(config.sensitiveConfig.account_sid || '').trim();
    const authToken = String(config.sensitiveConfig.auth_token || '').trim();
    const from = String(config.publicConfig.from_number || '').trim();
    const messagingServiceSid = String(config.publicConfig.messaging_service_sid || '').trim();
    if (!accountSid || !authToken || (!from && !messagingServiceSid)) throw new Error('Default Twilio WhatsApp provider configuration is incomplete.');
    const form = new URLSearchParams({ To: input.to.startsWith('whatsapp:') ? input.to : `whatsapp:+${input.to.replace(/\D/g, '')}`, Body: input.text });
    if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
    else form.set('From', from.startsWith('whatsapp:') ? from : `whatsapp:${from}`);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || `Twilio returned HTTP ${response.status}`);
    return { providerName: config.providerName, providerType: config.providerType, response: { ...payload, success: true, messageId: payload.sid || null } };
  }

  if (config.providerName === 'messagebird') {
    const apiKey = String(config.sensitiveConfig.api_key || '').trim();
    const channelId = String(config.publicConfig.channel_id || '').trim();
    if (!apiKey || !channelId) throw new Error('Default MessageBird WhatsApp provider configuration is incomplete.');
    const response = await fetch('https://conversations.messagebird.com/v1/send', {
      method: 'POST', headers: { Authorization: `AccessKey ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: input.to.replace(/\D/g, ''), from: channelId, type: 'text', content: { text: input.text } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.errors?.[0]?.description || `MessageBird returned HTTP ${response.status}`);
    return { providerName: config.providerName, providerType: config.providerType, response: { ...payload, success: true, messageId: payload.id || null } };
  }

  throw new Error(`Default WhatsApp provider ${config.providerName} does not have a sending adapter configured.`);
}

/**
 * Check if user is an admin
 */
export async function isAdminUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data: userProfile } = await supabase
    .from('users')
    .select(`
      roles!inner (
        role_level,
        role_code
      )
    `)
    .eq('id', userId)
    .single();

  if (!userProfile?.roles) {
    return false;
  }

  // Admin role level is typically <= 20 (super_admin = 10, admin = 20)
  // Or check specific role codes
  const role = userProfile.roles as any;
  return role.role_level <= 20 ||
    ['super_admin', 'admin', 'org_admin'].includes(role.role_code);
}

/**
 * Build gateway URL (single tenant legacy mode)
 * Sanitizes base URL and appends endpoint
 */
function buildGatewayUrl(baseUrl: string, endpoint: string): string {
  let sanitizedBaseUrl = baseUrl.trim();

  // Enforce HTTPS
  if (sanitizedBaseUrl.startsWith('http://')) {
    sanitizedBaseUrl = 'https://' + sanitizedBaseUrl.substring(7);
  } else if (!sanitizedBaseUrl.startsWith('https://')) {
    sanitizedBaseUrl = 'https://' + sanitizedBaseUrl;
  }

  // Remove port 3001 (hardening)
  sanitizedBaseUrl = sanitizedBaseUrl.replace(/:3001\/?$/, '');

  // Remove trailing slash
  if (sanitizedBaseUrl.endsWith('/')) {
    sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -1);
  }

  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  return `${sanitizedBaseUrl}${normalizedEndpoint}`;
}

/**
 * Translate Serapod2U endpoint paths to wa.getouch.co equivalents.
 * wa.getouch.co uses /api/* routes with different naming conventions.
 */
const GETOUCH_ENDPOINT_MAP: Record<string, string> = {
  '/status': '/api/status',
  '/session/qr': '/api/qr-code',
  '/messages/send': '/api/send-text',
  '/messages/send-image': '/api/send-image',
  '/session/start': '/api/reset',
  '/session/logout': '/api/logout',
  '/session/clear': '/api/logout',
  '/session/reset': '/api/reset',
};

/**
 * Call the gateway API
 * Uses legacy single-tenant endpoints (no /tenants/ prefix)
 */
export async function callGateway(
  baseUrl: string,
  apiKey: string | undefined,
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, any>,
  _tenantId: string = DEFAULT_TENANT_ID // Ignored in single-tenant mode
): Promise<any> {
  // Translate endpoint for Getouch gateway
  const isGetouchGateway = baseUrl.includes('getouch.co') || baseUrl.includes('getouch.cloud');
  const resolvedEndpoint = isGetouchGateway
    ? (GETOUCH_ENDPOINT_MAP[endpoint] || endpoint)
    : endpoint;

  // Build single-tenant endpoint
  const url = buildGatewayUrl(baseUrl, resolvedEndpoint);

  // Headers — both gateways use x-api-key
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  // Only add Content-Type for requests with body (POST, PUT, PATCH)
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const makeRequest = async (attempt = 1): Promise<any> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle HTML error responses (like 404 from old endpoints)
        const contentType = response.headers.get('content-type');
        let errorText;
        if (contentType && contentType.includes('application/json')) {
          const json = await response.json();
          errorText = json.error || json.message || JSON.stringify(json);
        } else {
          errorText = await response.text();
          // If we get "Cannot GET /tenants/..." it means we are hitting wrong endpoint on old config
          if (errorText.includes('Cannot GET /tenants')) {
            errorText = 'Endpoint mismatch (check if gateway is single-tenant)';
          }
        }
        throw new Error(`Gateway error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Gateway request timeout (8s)');
      }

      // Retry logic for network errors or 5xx errors (not 4xx client errors)
      // Retry once if attempt 1
      const isRetryable = error.name === 'TypeError' || // Network error
        (error.message && (error.message.includes('502') || error.message.includes('503') || error.message.includes('504')));

      if (attempt === 1 && isRetryable) {
        console.warn(`Gateway request failed, retrying... (${url})`);
        // Short delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        return makeRequest(2);
      }

      throw error;
    }
  };

  return makeRequest();
}

/**
 * Log gateway action (optional audit logging)
 */
export async function logGatewayAction(
  supabase: SupabaseClient,
  params: {
    action: string;
    userId: string;
    orgId: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  try {
    // Check if the audit log table exists before trying to insert
    const { error } = await supabase
      .from('whatsapp_gateway_audit_log')
      .insert({
        action: params.action,
        actor_user_id: params.userId,
        org_id: params.orgId,
        metadata: params.metadata || {},
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Table might not exist - just log to console instead
      console.log('WhatsApp Gateway Action:', {
        action: params.action,
        userId: params.userId,
        orgId: params.orgId,
        metadata: params.metadata,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    // Silently fail - audit logging is optional
    console.log('WhatsApp Gateway Action (audit table not available):', params);
  }
}
