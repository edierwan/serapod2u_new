/**
 * Webhook Service
 * 
 * Handles forwarding WhatsApp messages to external services.
 * Supports both inbound (user) and outbound (admin) message forwarding.
 */

import { logger } from '../utils/logger';

export type WebhookEventType = 'INBOUND_USER' | 'OUTBOUND_ADMIN';

interface WebhookPayload {
  event: WebhookEventType;
  tenantId: string;
  wa: {
    phoneDigits: string;
    remoteJid: string;
    fromMe: boolean;
    messageId: string;
    timestamp: number;
    pushName?: string;
    text: string;
  };
}

interface WebhookConfig {
  moltbotUrl: string;
  moltbotSecret: string;
  enabled: boolean;
  retryAttempts: number;
  retryDelay: number;
}

class WebhookService {
  private config: WebhookConfig;

  constructor() {
    this.config = {
      moltbotUrl: process.env.MOLTBOT_WEBHOOK_URL || 'http://127.0.0.1:4000/webhook/whatsapp',
      moltbotSecret: process.env.MOLTBOT_WEBHOOK_SECRET || '',
      enabled: process.env.MOLTBOT_WEBHOOK_ENABLED !== 'false',
      retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY || '1000'),
    };

    logger.info({
      webhookEnabled: this.config.enabled,
      moltbotUrl: this.config.moltbotUrl,
      hasSecret: !!this.config.moltbotSecret,
    }, 'WebhookService initialized');
  }

  /**
   * Check if webhook is enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.moltbotUrl;
  }

  /**
   * Forward incoming WhatsApp message to Moltbot
   * Handles both user messages (fromMe=false) and admin messages (fromMe=true)
   */
  async forwardToMoltbot(
    tenantId: string,
    message: {
      key: { remoteJid: string; id: string; fromMe: boolean };
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
      pushName?: string;
      messageTimestamp?: number;
    },
    ownNumber?: string
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      logger.debug({ tenantId }, 'Webhook disabled, skipping forward');
      return false;
    }

    // Extract message text
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text || '';
    
    if (!text) {
      logger.debug({ tenantId, messageId: message.key.id }, 'No text content, skipping');
      return false;
    }

    // Extract sender info
    const remoteJid = message.key.remoteJid || '';
    
    // Skip group messages - only handle 1:1 chats
    if (remoteJid.includes('@g.us')) {
      logger.debug({ tenantId, remoteJid }, 'Skipping group message');
      return false;
    }

    const phoneDigits = remoteJid.split('@')[0];
    const messageId = message.key.id;
    const fromMe = message.key.fromMe;

    // Determine event type
    const eventType: WebhookEventType = fromMe ? 'OUTBOUND_ADMIN' : 'INBOUND_USER';

    const payload: WebhookPayload = {
      event: eventType,
      tenantId,
      wa: {
        phoneDigits,
        remoteJid,
        fromMe,
        messageId,
        timestamp: typeof message.messageTimestamp === 'number' 
          ? message.messageTimestamp * 1000 
          : Date.now(),
        pushName: message.pushName,
        text,
      },
    };

    return this.sendToMoltbot(payload);
  }

  /**
   * Legacy method for backward compatibility
   */
  async forwardToSerapod(
    tenantId: string,
    message: {
      key: { remoteJid: string; id: string; fromMe: boolean };
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
      pushName?: string;
      messageTimestamp?: number;
    },
    ownNumber?: string
  ): Promise<boolean> {
    // Forward to moltbot instead
    return this.forwardToMoltbot(tenantId, message, ownNumber);
  }

  /**
   * Send payload to Moltbot with retry logic
   */
  private async sendToMoltbot(payload: WebhookPayload): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(this.config.moltbotUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-moltbot-secret': this.config.moltbotSecret,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json() as { ok?: boolean; error?: string };

        if (response.ok && data.ok !== false) {
          logger.info({
            tenantId: payload.tenantId,
            event: payload.event,
            messageId: payload.wa.messageId,
            phone: payload.wa.phoneDigits,
          }, 'Message forwarded to Moltbot');
          return true;
        }

        lastError = new Error(data.error || `HTTP ${response.status}`);
        logger.warn({
          tenantId: payload.tenantId,
          event: payload.event,
          messageId: payload.wa.messageId,
          attempt,
          error: lastError.message,
        }, 'Moltbot webhook request failed');

      } catch (error: any) {
        lastError = error;
        logger.warn({
          tenantId: payload.tenantId,
          event: payload.event,
          messageId: payload.wa.messageId,
          attempt,
          error: error.message,
        }, 'Moltbot webhook request error');
      }

      // Wait before retry (except last attempt)
      if (attempt < this.config.retryAttempts) {
        await new Promise(resolve => 
          setTimeout(resolve, this.config.retryDelay * attempt)
        );
      }
    }

    logger.error({
      tenantId: payload.tenantId,
      event: payload.event,
      messageId: payload.wa.messageId,
      error: lastError?.message,
    }, 'Failed to forward message after all retries');

    return false;
  }
}

// Export singleton instance
export const webhookService = new WebhookService();
