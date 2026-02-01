// src/services/supabase.service.ts
// Supabase client for Moltbot - uses service role key for admin operations

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

// Database types
export interface WhatsAppBotAdmin {
    id: string;
    org_id: string;
    phone_digits: string;
    display_name: string | null;
    is_active: boolean;
    created_at: string;
}

export interface WhatsAppConversation {
    id: string;
    org_id: string;
    user_phone_digits: string;
    mode: 'auto' | 'takeover';
    takeover_by_admin_phone: string | null;
    takeover_at: string | null;
    last_admin_activity_at: string | null;
    pending_draft: string | null;
    pending_draft_at: string | null;
    auto_revert_after_ms: number;
    message_count: number;
    last_message_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface WhatsAppBotSettings {
    id: string;
    org_id: string;
    auto_reply_enabled: boolean;
    tool_calling_enabled: boolean;
    safe_mode: boolean;
    llm_provider: string;
    llm_model: string;
    llm_temperature: number;
    llm_max_tokens: number;
    takeover_auto_revert_ms: number;
    greeting_enabled: boolean;
    bot_name: string;
    bot_language: string;
    gateway_api_key: string | null;
    webhook_secret: string | null;
    created_at: string;
    updated_at: string;
}

export interface WhatsAppBotSession {
    id: string;
    org_id: string;
    gateway_phone_digits: string;
    gateway_url: string | null;
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    wa_push_name: string | null;
    last_seen_at: string | null;
    last_health_check_at: string | null;
    error_message: string | null;
    moltbot_url: string | null;
    moltbot_status: string | null;
    moltbot_last_seen_at: string | null;
}

let supabaseClient: SupabaseClient | null = null;

/**
 * Get Supabase client (singleton)
 */
export function getSupabase(): SupabaseClient | null {
    if (!config.supabase.url || !config.supabase.serviceKey) {
        console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        return null;
    }

    if (!supabaseClient) {
        supabaseClient = createClient(config.supabase.url, config.supabase.serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }

    return supabaseClient;
}

/**
 * Normalize phone number to digits only with country code
 */
export function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    // If starts with 0, assume Malaysia and prepend 60
    if (digits.startsWith('0')) {
        return '60' + digits.substring(1);
    }
    return digits;
}

/**
 * Check if phone is admin for given org
 */
export async function isPhoneAdmin(orgId: string, phone: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase) return false;

    const phoneDigits = normalizePhone(phone);

    try {
        const { data, error } = await supabase
            .from('whatsapp_bot_admins')
            .select('id')
            .eq('org_id', orgId)
            .eq('phone_digits', phoneDigits)
            .eq('is_active', true)
            .single();

        return !error && !!data;
    } catch (err) {
        console.error('[Supabase] isPhoneAdmin error:', err);
        return false;
    }
}

/**
 * Get conversation state for user phone
 */
export async function getConversation(orgId: string, userPhone: string): Promise<WhatsAppConversation | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    const phoneDigits = normalizePhone(userPhone);

    try {
        const { data, error } = await supabase
            .from('whatsapp_conversations')
            .select('*')
            .eq('org_id', orgId)
            .eq('user_phone_digits', phoneDigits)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            console.error('[Supabase] getConversation error:', error);
        }

        return data || null;
    } catch (err) {
        console.error('[Supabase] getConversation error:', err);
        return null;
    }
}

/**
 * Upsert conversation (create or update)
 */
export async function upsertConversation(
    orgId: string,
    userPhone: string,
    updates: Partial<Omit<WhatsAppConversation, 'id' | 'org_id' | 'user_phone_digits' | 'created_at'>>
): Promise<WhatsAppConversation | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    const phoneDigits = normalizePhone(userPhone);

    try {
        const { data, error } = await supabase
            .from('whatsapp_conversations')
            .upsert({
                org_id: orgId,
                user_phone_digits: phoneDigits,
                ...updates,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'org_id,user_phone_digits'
            })
            .select()
            .single();

        if (error) {
            console.error('[Supabase] upsertConversation error:', error);
            return null;
        }

        return data;
    } catch (err) {
        console.error('[Supabase] upsertConversation error:', err);
        return null;
    }
}

/**
 * Set conversation mode
 */
export async function setConversationMode(
    orgId: string,
    userPhone: string,
    mode: 'auto' | 'takeover',
    adminPhone?: string
): Promise<WhatsAppConversation | null> {
    const updates: Partial<WhatsAppConversation> = {
        mode,
        updated_at: new Date().toISOString()
    };

    if (mode === 'takeover') {
        updates.takeover_by_admin_phone = adminPhone || null;
        updates.takeover_at = new Date().toISOString();
    } else {
        updates.takeover_by_admin_phone = null;
        updates.takeover_at = null;
    }

    return upsertConversation(orgId, userPhone, updates);
}

/**
 * Update admin activity timestamp
 */
export async function updateAdminActivity(
    orgId: string,
    userPhone: string,
    adminPhone: string
): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const phoneDigits = normalizePhone(userPhone);

    try {
        await supabase
            .from('whatsapp_conversations')
            .update({
                last_admin_activity_at: new Date().toISOString(),
                takeover_by_admin_phone: adminPhone,
                updated_at: new Date().toISOString()
            })
            .eq('org_id', orgId)
            .eq('user_phone_digits', phoneDigits);
    } catch (err) {
        console.error('[Supabase] updateAdminActivity error:', err);
    }
}

/**
 * Set pending draft
 */
export async function setPendingDraft(
    orgId: string,
    userPhone: string,
    draft: string
): Promise<WhatsAppConversation | null> {
    return upsertConversation(orgId, userPhone, {
        pending_draft: draft,
        pending_draft_at: new Date().toISOString()
    });
}

/**
 * Clear pending draft and return it
 */
export async function clearPendingDraft(
    orgId: string,
    userPhone: string
): Promise<string | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    const phoneDigits = normalizePhone(userPhone);

    try {
        // First get the draft
        const { data: conv } = await supabase
            .from('whatsapp_conversations')
            .select('pending_draft')
            .eq('org_id', orgId)
            .eq('user_phone_digits', phoneDigits)
            .single();

        const draft = conv?.pending_draft || null;

        // Then clear it
        await supabase
            .from('whatsapp_conversations')
            .update({
                pending_draft: null,
                pending_draft_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('org_id', orgId)
            .eq('user_phone_digits', phoneDigits);

        return draft;
    } catch (err) {
        console.error('[Supabase] clearPendingDraft error:', err);
        return null;
    }
}

/**
 * Get bot settings for org
 */
export async function getBotSettings(orgId: string): Promise<WhatsAppBotSettings | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('whatsapp_bot_settings')
            .select('*')
            .eq('org_id', orgId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('[Supabase] getBotSettings error:', error);
        }

        return data || null;
    } catch (err) {
        console.error('[Supabase] getBotSettings error:', err);
        return null;
    }
}

/**
 * Get session by gateway phone
 */
export async function getSessionByGatewayPhone(gatewayPhone: string): Promise<WhatsAppBotSession | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    const phoneDigits = normalizePhone(gatewayPhone);

    try {
        const { data, error } = await supabase
            .from('whatsapp_bot_sessions')
            .select('*')
            .eq('gateway_phone_digits', phoneDigits)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('[Supabase] getSessionByGatewayPhone error:', error);
        }

        return data || null;
    } catch (err) {
        console.error('[Supabase] getSessionByGatewayPhone error:', err);
        return null;
    }
}

/**
 * Increment message count for conversation
 */
export async function incrementMessageCount(orgId: string, userPhone: string): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const phoneDigits = normalizePhone(userPhone);

    try {
        await supabase.rpc('upsert_whatsapp_conversation', {
            p_org_id: orgId,
            p_user_phone: phoneDigits
        });
    } catch (err) {
        // If RPC doesn't exist, do manual update
        await supabase
            .from('whatsapp_conversations')
            .upsert({
                org_id: orgId,
                user_phone_digits: phoneDigits,
                message_count: 1,
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'org_id,user_phone_digits'
            });
    }
}

/**
 * Check if conversation should auto-revert to auto mode
 * Returns true if mode should be reverted
 */
export async function checkAutoRevert(orgId: string, userPhone: string): Promise<boolean> {
    const conv = await getConversation(orgId, userPhone);
    if (!conv || conv.mode !== 'takeover') return false;

    const revertMs = conv.auto_revert_after_ms || config.takeover.autoRevertMs;
    if (revertMs <= 0) return false;

    const lastActivity = conv.last_admin_activity_at || conv.takeover_at;
    if (!lastActivity) return false;

    const elapsed = Date.now() - new Date(lastActivity).getTime();
    return elapsed > revertMs;
}
