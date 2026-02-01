// src/services/webhook.handler.ts
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';
import { gatewayService } from './gateway.service';
import { aiService } from './ai.service';
import { InboundMsg } from '../types';

/**
 * Raw webhook payload from baileys-gateway
 */
interface RawWebhookPayload {
  tenantId?: string;
  from?: string;
  text?: string;
  message?: string;
  body?: string;
  timestamp?: number;
  messageId?: string;
  metadata?: {
    pushName?: string;
    [key: string]: any;
  };
  pushName?: string;
  // Alternative field names from gateway
  remoteJid?: string;
  key?: {
    remoteJid?: string;
    id?: string;
  };
  msg?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
  };
}

export class WebhookHandler {
  
  /**
   * Normalize incoming payload to standard format
   */
  private normalizePayload(raw: RawWebhookPayload): InboundMsg {
    // Extract phone number
    let phone = raw.from || '';
    
    // Try alternative locations
    if (!phone && raw.remoteJid) {
      phone = raw.remoteJid.replace(/@s\.whatsapp\.net$/, '');
    }
    if (!phone && raw.key?.remoteJid) {
      phone = raw.key.remoteJid.replace(/@s\.whatsapp\.net$/, '');
    }
    
    // Normalize phone
    phone = phone.replace(/\D/g, '');
    if (phone.startsWith('0')) {
      phone = '60' + phone.substring(1);
    }

    // Extract text
    let text = raw.text || raw.message || raw.body || '';
    
    // Try nested message structures
    if (!text && raw.msg?.conversation) {
      text = raw.msg.conversation;
    }
    if (!text && raw.msg?.extendedTextMessage?.text) {
      text = raw.msg.extendedTextMessage.text;
    }

    // Extract push name
    const pushName = raw.pushName || raw.metadata?.pushName;

    return {
      tenantId: raw.tenantId || 'default',
      from: phone,
      text: text.trim(),
      messageId: raw.messageId || raw.key?.id,
      timestamp: raw.timestamp || Date.now(),
      pushName,
      rawPayload: raw,
    };
  }

  /**
   * Handle inbound WhatsApp message
   */
  async handleInbound(req: Request, res: Response) {
    const startTime = Date.now();
    
    try {
      // 1. Validate webhook secret
      const secret = req.headers['x-moltbot-secret'] || 
                     req.headers['x-webhook-secret'] || 
                     req.headers['x-agent-key'];
      
      if (secret !== config.webhookSecret) {
        logger.warn({ 
          providedSecret: secret ? 'present' : 'missing' 
        }, 'Invalid webhook secret');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // 2. Normalize payload
      const msg = this.normalizePayload(req.body);

      // 3. Validate required fields
      if (!msg.from || !msg.text) {
        logger.warn({ 
          hasFrom: !!msg.from, 
          hasText: !!msg.text 
        }, 'Invalid webhook payload');
        return res.status(400).json({ error: 'Missing from or text' });
      }

      // 4. Log inbound
      logger.info({
        type: 'INBOUND',
        tenantId: msg.tenantId,
        from: msg.from,
        textPreview: msg.text.substring(0, 50),
        pushName: msg.pushName,
        messageId: msg.messageId,
      }, 'Received WhatsApp message');

      // 5. Process with AI and send reply (async)
      if (config.features.autoReply) {
        // Don't await - respond to webhook immediately
        this.processAndReply(msg).catch(err => {
          logger.error({ error: err.message }, 'Async reply processing failed');
        });
      }

      // 6. Acknowledge receipt immediately
      return res.status(200).json({ 
        ok: true, 
        processed: config.features.autoReply,
        messageId: msg.messageId,
      });

    } catch (error: any) {
      logger.error({ 
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Webhook handler error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Process message with AI and send reply
   */
  private async processAndReply(msg: InboundMsg): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 1. Process with AI service
      const result = await aiService.processMessage(msg);

      // 2. Send reply via gateway
      const success = await gatewayService.sendMessage(msg.from, result.reply);

      // 3. Log result
      logger.info({
        type: 'OUTBOUND',
        to: msg.from,
        replyPreview: result.reply.substring(0, 50),
        toolCalls: result.toolCalls?.map(tc => tc.name),
        sendSuccess: success,
        durationMs: Date.now() - startTime,
      }, 'Reply sent');

    } catch (error: any) {
      logger.error({
        to: msg.from,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Process and reply failed');
    }
  }

  /**
   * Manual send endpoint for debugging
   */
  async manualSend(req: Request, res: Response) {
    try {
      const { to, message } = req.query;
      
      if (!to || !message) {
        return res.status(400).json({ error: 'Missing to or message params' });
      }

      const result = await gatewayService.sendMessage(String(to), String(message));
      
      return res.json({ 
        ok: result,
        to,
        message
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  /**
   * Test AI processing (for debugging)
   */
  async testAI(req: Request, res: Response) {
    try {
      const { phone, text } = req.body;
      
      if (!phone || !text) {
        return res.status(400).json({ error: 'Missing phone or text' });
      }

      const msg: InboundMsg = {
        tenantId: 'default',
        from: phone,
        text,
        timestamp: Date.now(),
      };

      const result = await aiService.processMessage(msg);

      return res.json({
        ok: true,
        reply: result.reply,
        toolCalls: result.toolCalls?.map(tc => ({
          name: tc.name,
          args: tc.arguments,
        })),
        userProfile: result.userProfile ? {
          name: result.userProfile.name,
          hasUserId: !!result.userProfile.userId,
        } : null,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}

export const webhookHandler = new WebhookHandler();
