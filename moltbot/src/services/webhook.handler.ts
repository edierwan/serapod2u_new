// src/services/webhook.handler.ts
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';
import { gatewayService } from './gateway.service';
import { aiService } from './ai.service';
import { memoryStore } from './memory';
import { supabaseService } from './supabase.client';
import { parseCommand, isCommand } from '../utils/command-parser';
import {
  InboundMsg,
  GatewayWebhookPayload,
  WebhookEventType,
  ParsedCommand,
  ConversationMode,
} from '../types';

export class WebhookHandler {
  
  /**
   * Normalize phone number to digits only with 60 prefix
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '60' + cleaned.substring(1);
    }
    return cleaned;
  }

  /**
   * Convert new gateway payload to internal InboundMsg format
   */
  private toInboundMsg(payload: GatewayWebhookPayload): InboundMsg {
    const phone = this.normalizePhone(payload.wa.phoneDigits);
    
    return {
      tenantId: payload.tenantId,
      from: phone,
      text: payload.wa.text.trim(),
      messageId: payload.wa.messageId,
      timestamp: payload.wa.timestamp,
      pushName: payload.wa.pushName,
      rawPayload: payload,
    };
  }

  /**
   * Main webhook handler - handles both INBOUND_USER and OUTBOUND_ADMIN events
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

      // 2. Parse payload - new format with event type
      const payload = req.body as GatewayWebhookPayload;
      
      // Support legacy format
      if (!payload.event) {
        return this.handleLegacyPayload(req, res);
      }

      // 3. Validate required fields
      if (!payload.wa?.phoneDigits || !payload.wa?.text) {
        logger.warn({ 
          hasPhone: !!payload.wa?.phoneDigits, 
          hasText: !!payload.wa?.text 
        }, 'Invalid webhook payload');
        return res.status(400).json({ error: 'Missing phone or text' });
      }

      // 4. Route based on event type
      const event = payload.event as WebhookEventType;
      
      if (event === 'INBOUND_USER') {
        await this.handleUserMessage(payload);
      } else if (event === 'OUTBOUND_ADMIN') {
        await this.handleAdminMessage(payload);
      } else {
        logger.warn({ event }, 'Unknown event type');
      }

      // 5. Acknowledge receipt
      return res.status(200).json({ 
        ok: true, 
        event,
        messageId: payload.wa.messageId,
      });

    } catch (error: any) {
      logger.error({ 
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
      }, 'Webhook handler error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle message from WhatsApp user
   */
  private async handleUserMessage(payload: GatewayWebhookPayload): Promise<void> {
    const msg = this.toInboundMsg(payload);
    const { tenantId, from: phone, text } = msg;

    logger.info({
      type: 'INBOUND_USER',
      tenantId,
      phone,
      textPreview: text.substring(0, 50),
      pushName: payload.wa.pushName,
    }, 'User message received');

    // Store message to database
    if (config.features.dbWrites) {
      try {
        const convResult = await supabaseService.findOrCreateConversation(
          phone,
          undefined,
          payload.wa.pushName
        );
        
        if (convResult) {
          await supabaseService.insertMessage({
            conversationId: convResult.conversationId,
            direction: 'inbound',
            channel: 'whatsapp',
            bodyText: text,
            senderType: 'user',
            senderPhone: phone,
            externalMessageId: payload.wa.messageId,
          });
        }
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to store user message');
      }
    }

    // Check mode - only auto-reply if in auto mode
    const mode = memoryStore.getMode(tenantId, phone);
    
    // Check if should auto-revert to auto mode
    if (mode === 'takeover' && memoryStore.shouldResumeAuto(tenantId, phone)) {
      memoryStore.setMode(tenantId, phone, 'auto');
      logger.info({ tenantId, phone }, 'Auto-reverted to auto mode after inactivity');
    }
    
    const currentMode = memoryStore.getMode(tenantId, phone);

    if (currentMode === 'auto' && config.features.autoReply) {
      // Process with AI and reply
      this.processAndReply(msg).catch(err => {
        logger.error({ error: err.message }, 'Auto-reply processing failed');
      });
    } else {
      logger.info({
        tenantId,
        phone,
        mode: currentMode,
        autoReplyEnabled: config.features.autoReply,
      }, 'Skipping auto-reply (takeover mode or disabled)');
    }
  }

  /**
   * Handle message from admin via WhatsApp
   */
  private async handleAdminMessage(payload: GatewayWebhookPayload): Promise<void> {
    const tenantId = payload.tenantId;
    const phone = this.normalizePhone(payload.wa.phoneDigits);
    const text = payload.wa.text.trim();

    logger.info({
      type: 'OUTBOUND_ADMIN',
      tenantId,
      phone,
      textPreview: text.substring(0, 50),
    }, 'Admin message detected');

    // Check if it's a bot command
    if (isCommand(text)) {
      const command = parseCommand(text);
      
      if (command && command.isCommand) {
        logger.info({
          tenantId,
          phone,
          commandType: command.type,
          hasInstruction: !!command.instruction,
        }, 'Processing admin command');

        // Don't store command as regular message - handle it
        await this.handleCommand(tenantId, phone, command, payload.wa.messageId);
        return;
      }
    }

    // Regular admin message (not a command) - set takeover mode
    memoryStore.setMode(tenantId, phone, 'takeover');
    memoryStore.recordAdminActivity(tenantId, phone);

    logger.info({
      tenantId,
      phone,
    }, 'Switched to takeover mode (admin sent message)');

    // Store admin message to database
    if (config.features.dbWrites) {
      try {
        const convResult = await supabaseService.findOrCreateConversation(phone);
        
        if (convResult) {
          await supabaseService.insertMessage({
            conversationId: convResult.conversationId,
            direction: 'outbound',
            channel: 'whatsapp',
            bodyText: text,
            senderType: 'admin',
            externalMessageId: payload.wa.messageId,
          });
        }
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to store admin message');
      }
    }
  }

  /**
   * Handle admin bot command
   */
  private async handleCommand(
    tenantId: string, 
    phone: string, 
    command: ParsedCommand,
    messageId?: string
  ): Promise<void> {
    // Store command as system message
    if (config.features.dbWrites) {
      try {
        const convResult = await supabaseService.findOrCreateConversation(phone);
        if (convResult) {
          await supabaseService.insertSystemMessage(
            convResult.conversationId,
            `Admin Command: ${command.rawText}`,
            'Admin Command',
            { commandType: command.type, instruction: command.instruction }
          );
        }
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to store command');
      }
    }

    switch (command.type) {
      case 'reply':
        // Generate AI reply with optional instruction and send immediately
        await this.executeAIReply(tenantId, phone, command.instruction, true);
        break;

      case 'draft':
        // Generate AI draft but don't send
        await this.executeAIReply(tenantId, phone, command.instruction, false);
        break;

      case 'send':
        // Send pending draft
        await this.sendPendingDraft(tenantId, phone);
        break;

      case 'auto_on':
        memoryStore.setMode(tenantId, phone, 'auto');
        logger.info({ tenantId, phone }, 'Auto mode enabled by admin');
        break;

      case 'auto_off':
        memoryStore.setMode(tenantId, phone, 'takeover');
        memoryStore.recordAdminActivity(tenantId, phone);
        logger.info({ tenantId, phone }, 'Takeover mode enabled by admin');
        break;

      case 'summarize':
        await this.generateSummary(tenantId, phone);
        break;

      default:
        logger.warn({ command }, 'Unhandled command type');
    }
  }

  /**
   * Execute AI reply (with optional instruction)
   */
  private async executeAIReply(
    tenantId: string,
    phone: string,
    instruction: string | undefined,
    sendImmediately: boolean
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Create a fake inbound message with the last user message
      // The AI will use conversation history
      const msg: InboundMsg = {
        tenantId,
        from: phone,
        text: '', // Will be filled from history
        timestamp: Date.now(),
      };

      // Process with AI (with instruction context)
      const result = await aiService.processMessage(msg, instruction);

      if (sendImmediately) {
        // Send the reply
        const success = await gatewayService.sendMessage(phone, result.reply);
        
        logger.info({
          type: 'AI_COMMANDED_REPLY',
          phone,
          replyPreview: result.reply.substring(0, 50),
          success,
          hasInstruction: !!instruction,
          durationMs: Date.now() - startTime,
        }, 'AI commanded reply sent');

        // Store bot reply
        if (config.features.dbWrites) {
          const convResult = await supabaseService.findOrCreateConversation(phone);
          if (convResult) {
            await supabaseService.insertMessage({
              conversationId: convResult.conversationId,
              direction: 'outbound',
              channel: 'whatsapp',
              bodyText: result.reply,
              senderType: 'bot',
              origin: 'serapod', // commanded reply
              metadata: { commanded: true, instruction },
            });
          }
        }
      } else {
        // Store as draft
        memoryStore.setDraft(tenantId, phone, result.reply);
        
        if (config.features.dbWrites) {
          const convResult = await supabaseService.findOrCreateConversation(phone);
          if (convResult) {
            await supabaseService.storeDraft(convResult.conversationId, result.reply);
          }
        }

        logger.info({
          type: 'AI_DRAFT_CREATED',
          phone,
          draftPreview: result.reply.substring(0, 50),
          durationMs: Date.now() - startTime,
        }, 'AI draft created');
      }
    } catch (error: any) {
      logger.error({
        phone,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'AI reply execution failed');
    }
  }

  /**
   * Send pending draft
   */
  private async sendPendingDraft(tenantId: string, phone: string): Promise<void> {
    // Try memory first
    let draft = memoryStore.getDraft(tenantId, phone);
    
    // Try database
    if (!draft && config.features.dbWrites) {
      const convResult = await supabaseService.findOrCreateConversation(phone);
      if (convResult) {
        draft = await supabaseService.getPendingDraft(convResult.conversationId) ?? undefined;
      }
    }

    if (!draft) {
      logger.warn({ tenantId, phone }, 'No pending draft to send');
      return;
    }

    // Send the draft
    const success = await gatewayService.sendMessage(phone, draft);

    if (success) {
      // Clear draft
      memoryStore.clearDraft(tenantId, phone);
      
      if (config.features.dbWrites) {
        const convResult = await supabaseService.findOrCreateConversation(phone);
        if (convResult) {
          await supabaseService.clearDraft(convResult.conversationId);
          
          // Store as sent message
          await supabaseService.insertMessage({
            conversationId: convResult.conversationId,
            direction: 'outbound',
            channel: 'whatsapp',
            bodyText: draft,
            senderType: 'bot',
            origin: 'serapod',
            metadata: { wasDraft: true },
          });
        }
      }

      logger.info({ tenantId, phone }, 'Draft sent successfully');
    } else {
      logger.error({ tenantId, phone }, 'Failed to send draft');
    }
  }

  /**
   * Generate conversation summary
   */
  private async generateSummary(tenantId: string, phone: string): Promise<void> {
    try {
      const summary = await aiService.generateSummary(tenantId, phone);
      
      // Store summary as system message
      if (config.features.dbWrites) {
        const convResult = await supabaseService.findOrCreateConversation(phone);
        if (convResult) {
          await supabaseService.insertSystemMessage(
            convResult.conversationId,
            `Summary:\n${summary}`,
            'AI Summary',
            { type: 'summary' }
          );
        }
      }

      logger.info({
        tenantId,
        phone,
        summaryPreview: summary.substring(0, 100),
      }, 'Summary generated');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Summary generation failed');
    }
  }

  /**
   * Process message with AI and send reply (for auto mode)
   */
  private async processAndReply(msg: InboundMsg): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 1. Process with AI service
      const result = await aiService.processMessage(msg);

      // 2. Send reply via gateway
      const success = await gatewayService.sendMessage(msg.from, result.reply);

      // 3. Store bot reply
      if (config.features.dbWrites) {
        try {
          const convResult = await supabaseService.findOrCreateConversation(msg.from);
          if (convResult) {
            await supabaseService.insertMessage({
              conversationId: convResult.conversationId,
              direction: 'outbound',
              channel: 'whatsapp',
              bodyText: result.reply,
              senderType: 'bot',
              origin: 'serapod',
              metadata: { auto: true },
            });
          }
        } catch (err: any) {
          logger.error({ error: err.message }, 'Failed to store bot reply');
        }
      }

      // 4. Log result
      logger.info({
        type: 'OUTBOUND',
        to: msg.from,
        replyPreview: result.reply.substring(0, 50),
        toolCalls: result.toolCalls?.map(tc => tc.name),
        sendSuccess: success,
        durationMs: Date.now() - startTime,
      }, 'Auto-reply sent');

    } catch (error: any) {
      logger.error({
        to: msg.from,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Process and reply failed');
    }
  }

  /**
   * Handle legacy payload format (for backward compatibility)
   */
  private async handleLegacyPayload(req: Request, res: Response): Promise<Response> {
    const raw = req.body;
    
    // Extract phone
    let phone = raw.from || '';
    if (!phone && raw.remoteJid) {
      phone = raw.remoteJid.replace(/@s\.whatsapp\.net$/, '');
    }
    phone = this.normalizePhone(phone);

    // Extract text
    let text = raw.text || raw.message || raw.body || '';
    if (!text && raw.msg?.conversation) {
      text = raw.msg.conversation;
    }

    if (!phone || !text) {
      return res.status(400).json({ error: 'Missing from or text' });
    }

    const msg: InboundMsg = {
      tenantId: raw.tenantId || 'default',
      from: phone,
      text: text.trim(),
      messageId: raw.messageId || raw.key?.id,
      timestamp: raw.timestamp || Date.now(),
      pushName: raw.pushName || raw.metadata?.pushName,
      rawPayload: raw,
    };

    logger.info({
      type: 'INBOUND_LEGACY',
      tenantId: msg.tenantId,
      from: msg.from,
      textPreview: msg.text.substring(0, 50),
    }, 'Legacy webhook received');

    if (config.features.autoReply) {
      this.processAndReply(msg).catch(err => {
        logger.error({ error: err.message }, 'Async reply processing failed');
      });
    }

    return res.status(200).json({ 
      ok: true, 
      processed: config.features.autoReply,
      messageId: msg.messageId,
    });
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

  /**
   * Get conversation mode for a phone (API endpoint)
   */
  async getMode(req: Request, res: Response) {
    try {
      const { tenantId, phone } = req.params;
      
      if (!phone) {
        return res.status(400).json({ error: 'Missing phone' });
      }

      const mode = memoryStore.getMode(tenantId || 'default', phone);
      const draft = memoryStore.getDraft(tenantId || 'default', phone);

      return res.json({
        ok: true,
        phone,
        mode,
        hasDraft: !!draft,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  /**
   * Set conversation mode (API endpoint)
   */
  async setMode(req: Request, res: Response) {
    try {
      const { tenantId, phone } = req.params;
      const { mode } = req.body;
      
      if (!phone || !mode) {
        return res.status(400).json({ error: 'Missing phone or mode' });
      }

      if (mode !== 'auto' && mode !== 'takeover') {
        return res.status(400).json({ error: 'Invalid mode' });
      }

      memoryStore.setMode(tenantId || 'default', phone, mode as ConversationMode);

      return res.json({
        ok: true,
        phone,
        mode,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}

export const webhookHandler = new WebhookHandler();
