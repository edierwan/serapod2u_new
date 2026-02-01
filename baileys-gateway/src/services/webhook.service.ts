/**
 * Webhook Service
 * 
 * Handles forwarding WhatsApp messages to external services (Serapod).
 * Implements retry logic and error handling.
 */

import { logger } from '../utils/logger';

interface IngestPayload {
  tenantId: string;
  from: string;
  to?: string;
  messageId: string;
  chatId: string;
  text: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface WebhookConfig {
  url: string;
  apiKey: string;
  enabled: boolean;
  retryAttempts: number;
  retryDelay: number;
}

class WebhookService {
  private config: WebhookConfig;

  constructor() {
    this.config = {
      url: process.env.SERAPOD_INGEST_URL || process.env.WEBHOOK_URL || '',
      apiKey: process.env.SERAPOD_AGENT_KEY || process.env.WEBHOOK_API_KEY || '',
      enabled: process.env.WEBHOOK_ENABLED === 'true' || !!process.env.SERAPOD_INGEST_URL,
      retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY || '1000'),
    };

    logger.info({
      webhookEnabled: this.config.enabled,
      webhookUrl: this.config.url ? this.config.url.substring(0, 50) + '...' : 'not configured',
    }, 'WebhookService initialized');
  }

  /**
   * Check if webhook is enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.url && !!this.config.apiKey;
  }

  /**
   * Update webhook configuration
   */
  updateConfig(config: Partial<WebhookConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ enabled: this.config.enabled }, 'Webhook config updated');
  }

  /**
   * Forward incoming WhatsApp message to Serapod
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
    const senderPhone = remoteJid.split('@')[0];
    const chatId = remoteJid;
    const messageId = message.key.id;
    const isFromMe = message.key.fromMe;

    // Skip if it's our own outgoing message (to avoid echo loops)
    if (isFromMe) {
      logger.debug({ tenantId, messageId }, 'Skipping own message (fromMe=true)');
      return false;
    }

    const payload: IngestPayload = {
      tenantId,
      from: senderPhone,
      to: ownNumber,
      messageId,
      chatId,
      text,
      timestamp: typeof message.messageTimestamp === 'number' 
        ? message.messageTimestamp * 1000 
        : Date.now(),
      metadata: {
        pushName: message.pushName,
        source: 'baileys-gateway',
      },
    };

    return this.sendWithRetry(payload);
  }

  /**
   * Send payload to webhook with retry logic
   */
  private async sendWithRetry(payload: IngestPayload): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-key': this.config.apiKey,
            'x-api-key': this.config.apiKey,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json() as { ok?: boolean; error?: string; threadId?: string; dedup?: boolean };

        if (response.ok && data.ok) {
          logger.info({
            tenantId: payload.tenantId,
            messageId: payload.messageId,
            threadId: data.threadId,
            dedup: data.dedup,
          }, 'Message forwarded to Serapod');
          return true;
        }

        // Check for dedup (not an error)
        if (data.dedup) {
          logger.debug({
            tenantId: payload.tenantId,
            messageId: payload.messageId,
          }, 'Message deduplicated');
          return true;
        }

        lastError = new Error(data.error || `HTTP ${response.status}`);
        logger.warn({
          tenantId: payload.tenantId,
          messageId: payload.messageId,
          attempt,
          error: lastError.message,
        }, 'Webhook request failed');

      } catch (error: any) {
        lastError = error;
        logger.warn({
          tenantId: payload.tenantId,
          messageId: payload.messageId,
          attempt,
          error: error.message,
        }, 'Webhook request error');
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
      messageId: payload.messageId,
      error: lastError?.message,
    }, 'Failed to forward message after all retries');

    return false;
  }
}

// Export singleton instance
export const webhookService = new WebhookService();
