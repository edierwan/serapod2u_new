// src/services/supabase.client.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  SupportMessage,
  SenderType,
  MessageDirection,
  MessageChannel,
  MessageOrigin,
  ConversationMode,
} from '../types';

/**
 * Supabase client for direct database operations
 * Uses service role key for unrestricted access
 */
class SupabaseService {
  private client: SupabaseClient | null = null;
  private enabled: boolean = false;

  constructor() {
    const url = config.supabase.url;
    const key = config.supabase.serviceKey;

    if (url && key) {
      this.client = createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      this.enabled = true;
      logger.info({ url: url.substring(0, 30) + '...' }, 'Supabase client initialized');
    } else {
      logger.warn('Supabase not configured - direct DB writes disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled && !!this.client;
  }

  /**
   * Normalize phone to E.164 format
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '60' + cleaned.substring(1);
    }
    return '+' + cleaned;
  }

  /**
   * Find or create a support conversation for a WhatsApp user
   */
  async findOrCreateConversation(
    phone: string,
    externalChatId?: string,
    pushName?: string
  ): Promise<{ conversationId: string; isNew: boolean } | null> {
    if (!this.client) return null;

    const phoneE164 = this.normalizePhone(phone);

    try {
      // Call the database function
      const { data, error } = await this.client.rpc('find_or_create_whatsapp_conversation', {
        p_user_phone: phoneE164,
        p_external_chat_id: externalChatId || null,
        p_subject: pushName ? `WhatsApp: ${pushName}` : 'WhatsApp Conversation',
      });

      if (error) {
        logger.error({ error: error.message, phone: phoneE164 }, 'Failed to find/create conversation');
        return null;
      }

      // The function returns a UUID
      const conversationId = data as string;

      logger.info({ conversationId, phone: phoneE164 }, 'Conversation found/created');

      return {
        conversationId,
        isNew: false, // We don't track this in the function, assume found
      };
    } catch (error: any) {
      logger.error({ error: error.message, phone: phoneE164 }, 'Error finding/creating conversation');
      return null;
    }
  }

  /**
   * Insert a message into support_conversation_messages using the dedup function
   */
  async insertMessage(msg: SupportMessage): Promise<{ messageId: string; isDuplicate: boolean } | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client.rpc('insert_whatsapp_message', {
        p_conversation_id: msg.conversationId,
        p_direction: msg.direction,
        p_sender_type: msg.senderType,
        p_sender_user_id: msg.senderUserId || null,
        p_sender_admin_id: msg.senderAdminId || null,
        p_sender_phone: msg.senderPhone ? this.normalizePhone(msg.senderPhone) : null,
        p_body_text: msg.bodyText,
        p_external_message_id: msg.externalMessageId || null,
        p_external_chat_id: msg.externalChatId || null,
        p_metadata: msg.metadata || {},
      });

      if (error) {
        logger.error({ error: error.message }, 'Failed to insert message');
        return null;
      }

      // Function returns { message_id, is_duplicate }
      const result = data as { message_id: string; is_duplicate: boolean }[];
      if (result && result.length > 0) {
        return {
          messageId: result[0].message_id,
          isDuplicate: result[0].is_duplicate,
        };
      }

      return null;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error inserting message');
      return null;
    }
  }

  /**
   * Insert a system message (commands, drafts, logs)
   */
  async insertSystemMessage(
    conversationId: string,
    text: string,
    label: string,
    metadata?: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client
        .from('support_conversation_messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          channel: 'ai',
          sender_type: 'system',
          body_text: text,
          is_system: true,
          origin: 'serapod',
          metadata: {
            label,
            ...metadata,
          },
        })
        .select('id')
        .single();

      if (error) {
        logger.error({ error: error.message }, 'Failed to insert system message');
        return null;
      }

      return data?.id || null;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error inserting system message');
      return null;
    }
  }

  /**
   * Get conversation mode from database
   */
  async getConversationMode(conversationId: string): Promise<ConversationMode | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client
        .from('support_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();

      if (error) {
        return null;
      }

      const metadata = data?.metadata as { mode?: ConversationMode } | null;
      return metadata?.mode || 'auto';
    } catch {
      return 'auto';
    }
  }

  /**
   * Update conversation mode in database
   */
  async setConversationMode(conversationId: string, mode: ConversationMode): Promise<boolean> {
    if (!this.client) return false;

    try {
      const { error } = await this.client
        .from('support_conversations')
        .update({
          metadata: { mode },
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (error) {
        logger.error({ error: error.message }, 'Failed to update conversation mode');
        return false;
      }

      logger.info({ conversationId, mode }, 'Conversation mode updated');
      return true;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error updating conversation mode');
      return false;
    }
  }

  /**
   * Store AI draft in conversation
   */
  async storeDraft(conversationId: string, draft: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const { error } = await this.client
        .from('support_conversations')
        .update({
          metadata: {
            pending_draft: draft,
            pending_draft_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (error) {
        logger.error({ error: error.message }, 'Failed to store draft');
        return false;
      }

      return true;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error storing draft');
      return false;
    }
  }

  /**
   * Get pending draft from conversation
   */
  async getPendingDraft(conversationId: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client
        .from('support_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();

      if (error) {
        return null;
      }

      const metadata = data?.metadata as { pending_draft?: string } | null;
      return metadata?.pending_draft || null;
    } catch {
      return null;
    }
  }

  /**
   * Clear pending draft
   */
  async clearDraft(conversationId: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const { data: current } = await this.client
        .from('support_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();

      const currentMeta = (current?.metadata || {}) as Record<string, unknown>;
      delete currentMeta.pending_draft;
      delete currentMeta.pending_draft_at;

      const { error } = await this.client
        .from('support_conversations')
        .update({
          metadata: currentMeta,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Get admin by WhatsApp phone
   */
  async getAdminByPhone(phone: string): Promise<{ adminUserId: string; displayName: string } | null> {
    if (!this.client) return null;

    const phoneE164 = this.normalizePhone(phone);

    try {
      const { data, error } = await this.client.rpc('get_admin_by_whatsapp_phone', {
        p_phone: phoneE164,
      });

      if (error || !data || data.length === 0) {
        return null;
      }

      return {
        adminUserId: data[0].admin_user_id,
        displayName: data[0].display_name,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get recent messages for a conversation (for AI context)
   */
  async getRecentMessages(conversationId: string, limit: number = 10): Promise<Array<{
    senderType: SenderType;
    bodyText: string;
    createdAt: string;
  }>> {
    if (!this.client) return [];

    try {
      const { data, error } = await this.client
        .from('support_conversation_messages')
        .select('sender_type, body_text, created_at')
        .eq('conversation_id', conversationId)
        .eq('is_system', false)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []).reverse().map(m => ({
        senderType: m.sender_type as SenderType,
        bodyText: m.body_text,
        createdAt: m.created_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Log WhatsApp message to logs table
   */
  async logMessage(
    direction: 'inbound' | 'outbound',
    phone: string,
    action: string,
    status: string,
    metadata?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.from('whatsapp_message_logs').insert({
        tenant_id: 'default',
        direction,
        phone_e164: this.normalizePhone(phone),
        action,
        status,
        error_message: errorMessage,
        metadata: metadata || {},
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to log message');
    }
  }
}

// Singleton instance
export const supabaseService = new SupabaseService();
