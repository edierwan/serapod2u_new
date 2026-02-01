/**
 * WhatsApp Gateway API Utilities
 * 
 * Shared utilities for WhatsApp gateway API routes
 * Updated for multi-tenant gateway endpoints
 */

import { SupabaseClient } from '@supabase/supabase-js';

// Default tenant ID for Serapod2u
const DEFAULT_TENANT_ID = 'serapod2u';

/**
 * Get WhatsApp configuration from database
 */
export async function getWhatsAppConfig(supabase: SupabaseClient, orgId: string) {
  const { data, error } = await supabase
    .from('notification_provider_configs')
    .select('config_public, config_encrypted')
    .eq('org_id', orgId)
    .eq('channel', 'whatsapp')
    .eq('provider_name', 'baileys')
    .single();

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
    baseUrl: publicConfig.base_url,
    apiKey: sensitiveConfig.api_key,
    testNumber: publicConfig.test_number,
    tenantId: publicConfig.tenant_id || DEFAULT_TENANT_ID,
  };
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
  // Build single-tenant endpoint
  const url = buildGatewayUrl(baseUrl, endpoint);

  // Headers setup
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  // Only add Content-Type for requests with body (POST, PUT, PATCH)
  if (method !== 'GET' && method !== 'DELETE') {
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
