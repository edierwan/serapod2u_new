// src/services/webhook.handler.ts
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';
import { gatewayService } from './gateway.service';
import { aiService } from './ai.service';
import { memoryStore } from './memory';
import { supabaseService } from './supabase.client';
import * as supabaseDB from './supabase.service';
import { parseCommand, isCommand } from '../utils/command-parser';
import {
    InboundMsg,
    GatewayWebhookPayload,
    WebhookEventType,
    ParsedCommand,
    ConversationMode,
} from '../types';

/**
 * Event types for structured logging
 */
type LogEventType =
    | 'INBOUND_USER'      // Message from end-user via WhatsApp
    | 'INBOUND_ADMIN'     // Message from admin via WhatsApp (non-command)
    | 'OUTBOUND_BOT'      // Bot auto-reply or commanded reply
    | 'OUTBOUND_ADMIN'    // Admin reply (manual, not bot)
    | 'MODE_CHANGED'      // Conversation mode changed
    | 'COMMAND_RECEIVED'  // Admin command received
    | 'DRAFT_CREATED'     // AI draft generated
    | 'DRAFT_SENT';       // Draft sent by admin

export class WebhookHandler {

    /**
     * Forward a message summary to all active admin phones for the org.
     * This lets admins see user messages and bot replies on their WhatsApp.
     */
    private async forwardToAdmins(
        orgId: string | null,
        senderPhone: string,
        senderName: string | undefined,
        messageText: string,
        messageType: 'user' | 'bot' | 'system',
        excludePhone?: string
    ): Promise<void> {
        if (!orgId) return;

        try {
            const adminPhones = await supabaseDB.getActiveAdminPhones(orgId);
            if (adminPhones.length === 0) return;

            // Format the forwarded message
            let prefix = '';
            const displayName = senderName || senderPhone;
            switch (messageType) {
                case 'user':
                    prefix = `📩 *New message from ${displayName}*\n_(${senderPhone})_\n\n`;
                    break;
                case 'bot':
                    prefix = `🤖 *AI Bot replied to ${displayName}*\n_(${senderPhone})_\n\n`;
                    break;
                case 'system':
                    prefix = `⚙️ *System* — `;
                    break;
            }

            const forwardText = `${prefix}${messageText}`;

            // Send to each admin (except the sender if they're an admin)
            for (const adminPhone of adminPhones) {
                if (excludePhone && adminPhone === this.normalizePhone(excludePhone)) continue;

                try {
                    await gatewayService.sendMessage(adminPhone, forwardText);
                } catch (err: any) {
                    logger.error({ adminPhone, error: err.message }, 'Failed to forward to admin');
                }
            }
        } catch (err: any) {
            logger.error({ orgId, error: err.message }, 'forwardToAdmins failed');
        }
    }

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
     * Resolve org_id from gateway phone (tenant mapping)
     * In a multi-tenant setup, the gateway phone number maps to an org
     */
    private async resolveOrgId(tenantId: string, gatewayPhone?: string): Promise<string | null> {
        // Try to get from session by gateway phone
        if (gatewayPhone) {
            const session = await supabaseDB.getSessionByGatewayPhone(gatewayPhone);
            if (session?.org_id) {
                return session.org_id;
            }
        }

        // Fallback: use tenantId as org_id directly (for single-tenant setup)
        // In production, this should be a proper mapping
        if (tenantId && tenantId !== 'default') {
            return tenantId;
        }

        // Final fallback: use env var if set (for testing)
        const defaultOrgId = process.env.DEFAULT_ORG_ID;
        if (defaultOrgId) {
            return defaultOrgId;
        }

        logger.warn({ tenantId, gatewayPhone }, 'Could not resolve org_id');
        return null;
    }

    /**
     * Log structured event for auditing
     */
    private logEvent(
        eventType: LogEventType,
        phone: string,
        details: Record<string, unknown> = {}
    ): void {
        logger.info({
            event: eventType,
            phone,
            timestamp: new Date().toISOString(),
            ...details,
        }, `[${eventType}] ${phone}`);
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
     * Main webhook handler - handles both INBOUND and OUTBOUND events
     * 
     * Detection logic:
     * - fromMe=false → message from someone to our WhatsApp number
     *   - If sender is in ADMIN_WA_NUMBERS → treat as admin (unusual, but possible)
     *   - Otherwise → treat as end-user (INBOUND_USER)
     * - fromMe=true → message sent FROM our WhatsApp number
     *   - Always treat as admin/bot action (OUTBOUND_ADMIN)
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
                // Message received TO our WhatsApp (fromMe=false)
                await this.handleInboundMessage(payload);
            } else if (event === 'OUTBOUND_ADMIN') {
                // Message sent FROM our WhatsApp (fromMe=true)
                await this.handleOutboundMessage(payload);
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
     * Handle inbound message (fromMe=false) - typically from end-user
     */
    private async handleInboundMessage(payload: GatewayWebhookPayload): Promise<void> {
        const msg = this.toInboundMsg(payload);
        const { tenantId, from: phone, text } = msg;

        // Resolve org_id from tenant/gateway
        const orgId = await this.resolveOrgId(tenantId, payload.wa.gatewayPhone);

        // Check if sender is an admin (from DB, not static env)
        let senderIsAdmin = false;
        if (orgId) {
            senderIsAdmin = await supabaseDB.isPhoneAdmin(orgId, phone);
        }

        if (senderIsAdmin) {
            // Admin messaging FROM their personal WhatsApp TO our number
            // This is unusual but possible - treat as admin input
            this.logEvent('INBOUND_ADMIN', phone, {
                tenantId,
                orgId,
                textPreview: text.substring(0, 50),
                pushName: payload.wa.pushName,
                note: 'Admin messaging from personal WhatsApp',
            });

            // Don't auto-reply to admins messaging in
            return;
        }

        // Normal end-user message
        this.logEvent('INBOUND_USER', phone, {
            tenantId,
            orgId,
            textPreview: text.substring(0, 50),
            pushName: payload.wa.pushName,
        });

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

        // Get conversation mode from DB (with fallback to memory)
        let currentMode: 'auto' | 'takeover' = 'auto';
        let conversation: supabaseDB.WhatsAppConversation | null = null;

        if (orgId) {
            conversation = await supabaseDB.getConversation(orgId, phone);

            // Check if should auto-revert to auto mode after admin inactivity
            if (conversation?.mode === 'takeover') {
                const shouldRevert = await supabaseDB.checkAutoRevert(orgId, phone);
                if (shouldRevert) {
                    await supabaseDB.setConversationMode(orgId, phone, 'auto');
                    conversation = await supabaseDB.getConversation(orgId, phone);

                    this.logEvent('MODE_CHANGED', phone, {
                        tenantId,
                        orgId,
                        from: 'takeover',
                        to: 'auto',
                        reason: 'admin_inactivity_timeout',
                    });

                    // Store system message
                    if (config.features.dbWrites) {
                        await this.storeSystemMessage(phone, 'Mode auto-reverted to AUTO (admin inactive)');
                    }
                }
            }

            currentMode = conversation?.mode || 'auto';

            // Also update message count
            await supabaseDB.incrementMessageCount(orgId, phone);
        } else {
            // Fallback to in-memory mode (for testing without DB)
            const prevMode = memoryStore.getMode(tenantId, phone);
            if (prevMode === 'takeover' && memoryStore.shouldResumeAuto(tenantId, phone)) {
                memoryStore.setMode(tenantId, phone, 'auto');
            }
            currentMode = memoryStore.getMode(tenantId, phone) as 'auto' | 'takeover';
        }

        if (currentMode === 'auto' && config.features.autoReply) {
            // Process with AI and reply
            this.processAndReply(msg, orgId || undefined).catch(err => {
                logger.error({ error: err.message }, 'Auto-reply processing failed');
            });
        } else {
            logger.debug({
                tenantId,
                orgId,
                phone,
                mode: currentMode,
                autoReplyEnabled: config.features.autoReply,
            }, 'Skipping auto-reply (takeover mode or disabled)');

            // In takeover mode, still forward user message to admins so they can see it
            if (currentMode === 'takeover' && orgId) {
                this.forwardToAdmins(orgId, phone, payload.wa.pushName, text, 'user').catch(err => {
                    logger.error({ error: err.message }, 'Failed to forward user msg to admins (takeover)');
                });
            }
        }
    }

    /**
     * Handle outbound message (fromMe=true) - admin reply via WhatsApp app
     */
    private async handleOutboundMessage(payload: GatewayWebhookPayload): Promise<void> {
        const tenantId = payload.tenantId;
        const phone = this.normalizePhone(payload.wa.phoneDigits);
        const text = payload.wa.text.trim();

        // Resolve org_id from tenant/gateway
        const orgId = await this.resolveOrgId(tenantId, payload.wa.gatewayPhone);

        // Check if it's a bot command
        if (isCommand(text)) {
            const command = parseCommand(text);

            if (command && command.isCommand) {
                this.logEvent('COMMAND_RECEIVED', phone, {
                    tenantId,
                    orgId,
                    commandType: command.type,
                    hasInstruction: !!command.instruction,
                });

                // Handle command - don't store as regular message
                await this.handleCommand(tenantId, phone, command, payload.wa.messageId, orgId || undefined);
                return;
            }
        }

        // Regular admin message (not a command)
        this.logEvent('OUTBOUND_ADMIN', phone, {
            tenantId,
            orgId,
            textPreview: text.substring(0, 50),
        });

        // Set takeover mode (use DB if org available)
        if (orgId) {
            const conversation = await supabaseDB.getConversation(orgId, phone);
            const prevMode = conversation?.mode || 'auto';

            if (prevMode !== 'takeover') {
                await supabaseDB.setConversationMode(orgId, phone, 'takeover');

                this.logEvent('MODE_CHANGED', phone, {
                    tenantId,
                    orgId,
                    from: prevMode,
                    to: 'takeover',
                    reason: 'admin_manual_reply',
                });

                // Store system message
                if (config.features.dbWrites) {
                    await this.storeSystemMessage(phone, 'Admin takeover - bot paused');
                }
            } else {
                await supabaseDB.updateAdminActivity(orgId, phone, phone);
            }
        } else {
            // Fallback to memory store
            const prevMode = memoryStore.getMode(tenantId, phone);
            if (prevMode !== 'takeover') {
                memoryStore.setMode(tenantId, phone, 'takeover');
                memoryStore.recordAdminActivity(tenantId, phone);

                this.logEvent('MODE_CHANGED', phone, {
                    tenantId,
                    from: prevMode,
                    to: 'takeover',
                    reason: 'admin_manual_reply',
                });

                if (config.features.dbWrites) {
                    await this.storeSystemMessage(phone, 'Admin takeover - bot paused');
                }
            } else {
                memoryStore.recordAdminActivity(tenantId, phone);
            }
        }

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
     * Store system message to database
     */
    private async storeSystemMessage(phone: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
        try {
            const convResult = await supabaseService.findOrCreateConversation(phone);
            if (convResult) {
                await supabaseService.insertSystemMessage(
                    convResult.conversationId,
                    message,
                    'System',
                    metadata
                );
            }
        } catch (err: any) {
            logger.error({ error: err.message }, 'Failed to store system message');
        }
    }

    /**
     * Handle admin bot command
     */
    private async handleCommand(
        tenantId: string,
        phone: string,
        command: ParsedCommand,
        messageId?: string,
        orgId?: string
    ): Promise<void> {
        // Store command as system message
        if (config.features.dbWrites) {
            await this.storeSystemMessage(phone, `Command: ${command.rawText}`, {
                commandType: command.type,
                instruction: command.instruction,
            });
        }

        switch (command.type) {
            case 'reply':
                // Generate AI reply with optional instruction and send immediately
                await this.executeAIReply(tenantId, phone, command.instruction, true, orgId);
                break;

            case 'draft':
                // Generate AI draft but don't send
                await this.executeAIReply(tenantId, phone, command.instruction, false, orgId);
                break;

            case 'send':
                // Send pending draft
                await this.sendPendingDraft(tenantId, phone, orgId);
                break;

            case 'auto_on':
                await this.setModeWithLog(tenantId, phone, 'auto', 'command', orgId);
                break;

            case 'auto_off':
                await this.setModeWithLog(tenantId, phone, 'takeover', 'command', orgId);
                break;

            case 'summarize':
                await this.generateSummary(tenantId, phone);
                break;

            default:
                logger.warn({ command }, 'Unhandled command type');
        }
    }

    /**
     * Set mode with logging and DB system message
     */
    private async setModeWithLog(
        tenantId: string,
        phone: string,
        newMode: ConversationMode,
        reason: string,
        orgId?: string
    ): Promise<void> {
        let prevMode: ConversationMode = 'auto';

        // Use DB if org available
        if (orgId) {
            const conversation = await supabaseDB.getConversation(orgId, phone);
            prevMode = conversation?.mode || 'auto';

            if (prevMode !== newMode) {
                await supabaseDB.setConversationMode(orgId, phone, newMode);

                this.logEvent('MODE_CHANGED', phone, {
                    tenantId,
                    orgId,
                    from: prevMode,
                    to: newMode,
                    reason,
                });

                if (config.features.dbWrites) {
                    const message = newMode === 'auto'
                        ? 'AI auto-reply enabled'
                        : 'AI auto-reply disabled (admin takeover)';
                    await this.storeSystemMessage(phone, message, { mode: newMode, reason });
                }
            }
        } else {
            // Fallback to memory store
            prevMode = memoryStore.getMode(tenantId, phone) as ConversationMode;

            if (prevMode !== newMode) {
                memoryStore.setMode(tenantId, phone, newMode);
                if (newMode === 'takeover') {
                    memoryStore.recordAdminActivity(tenantId, phone);
                }

                this.logEvent('MODE_CHANGED', phone, {
                    tenantId,
                    from: prevMode,
                    to: newMode,
                    reason,
                });

                if (config.features.dbWrites) {
                    const message = newMode === 'auto'
                        ? 'AI auto-reply enabled'
                        : 'AI auto-reply disabled (admin takeover)';
                    await this.storeSystemMessage(phone, message, { mode: newMode, reason });
                }
            }
        }
    }

    /**
     * Execute AI reply (with optional instruction)
     */
    private async executeAIReply(
        tenantId: string,
        phone: string,
        instruction: string | undefined,
        sendImmediately: boolean,
        orgId?: string
    ): Promise<void> {
        const startTime = Date.now();

        try {
            // Create a fake inbound message - AI will use conversation history
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

                this.logEvent('OUTBOUND_BOT', phone, {
                    tenantId,
                    replyPreview: result.reply.substring(0, 50),
                    success,
                    hasInstruction: !!instruction,
                    commanded: true,
                    durationMs: Date.now() - startTime,
                });

                // Store bot reply
                if (config.features.dbWrites) {
                    const convResult = await supabaseService.findOrCreateConversation(phone);
                    if (convResult) {
                        await supabaseService.insertMessage({
                            conversationId: convResult.conversationId,
                            direction: 'outbound',
                            channel: 'ai',
                            bodyText: result.reply,
                            senderType: 'bot',
                            origin: 'serapod',
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

                this.logEvent('DRAFT_CREATED', phone, {
                    tenantId,
                    draftPreview: result.reply.substring(0, 50),
                    durationMs: Date.now() - startTime,
                });

                // Store system message about draft
                if (config.features.dbWrites) {
                    await this.storeSystemMessage(phone, 'AI draft generated (pending send)', {
                        draftPreview: result.reply.substring(0, 100),
                    });
                }
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
    private async sendPendingDraft(tenantId: string, phone: string, orgId?: string): Promise<void> {
        let draft: string | null = null;

        // Try DB first if org available
        if (orgId) {
            draft = await supabaseDB.clearPendingDraft(orgId, phone);
        }

        // Try memory next
        if (!draft) {
            draft = memoryStore.getDraft(tenantId, phone) || null;
        }

        // Try legacy database
        if (!draft && config.features.dbWrites) {
            const convResult = await supabaseService.findOrCreateConversation(phone);
            if (convResult) {
                draft = await supabaseService.getPendingDraft(convResult.conversationId) ?? null;
            }
        }

        if (!draft) {
            logger.warn({ tenantId, orgId, phone }, 'No pending draft to send');
            return;
        }

        // Send the draft
        const success = await gatewayService.sendMessage(phone, draft);

        if (success) {
            // Clear draft from memory
            memoryStore.clearDraft(tenantId, phone);

            this.logEvent('DRAFT_SENT', phone, {
                tenantId,
                orgId,
                draftPreview: draft.substring(0, 50),
            });

            if (config.features.dbWrites) {
                const convResult = await supabaseService.findOrCreateConversation(phone);
                if (convResult) {
                    await supabaseService.clearDraft(convResult.conversationId);

                    // Store as sent message
                    await supabaseService.insertMessage({
                        conversationId: convResult.conversationId,
                        direction: 'outbound',
                        channel: 'ai',
                        bodyText: draft,
                        senderType: 'bot',
                        origin: 'serapod',
                        metadata: { wasDraft: true },
                    });
                }
            }
        } else {
            logger.error({ tenantId, orgId, phone }, 'Failed to send draft');
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
                await this.storeSystemMessage(phone, `Summary:\n${summary}`, { type: 'summary' });
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
    private async processAndReply(msg: InboundMsg, orgId?: string): Promise<void> {
        const startTime = Date.now();

        try {
            // Forward user message to admin phones first
            if (orgId) {
                this.forwardToAdmins(orgId, msg.from, msg.pushName, msg.text, 'user').catch(err => {
                    logger.error({ error: err.message }, 'Failed to forward user msg to admins');
                });
            }

            // 1. Process with AI service
            const result = await aiService.processMessage(msg);

            // 2. Send reply via gateway
            const success = await gatewayService.sendMessage(msg.from, result.reply);

            // 3. Log the event
            this.logEvent('OUTBOUND_BOT', msg.from, {
                tenantId: msg.tenantId,
                replyPreview: result.reply.substring(0, 50),
                toolCalls: result.toolCalls?.map(tc => tc.name),
                success,
                auto: true,
                durationMs: Date.now() - startTime,
            });

            // 4. Store bot reply
            if (config.features.dbWrites) {
                try {
                    const convResult = await supabaseService.findOrCreateConversation(msg.from);
                    if (convResult) {
                        await supabaseService.insertMessage({
                            conversationId: convResult.conversationId,
                            direction: 'outbound',
                            channel: 'ai',
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

            // 5. Forward bot reply to admin phones so they see what bot said
            if (orgId) {
                this.forwardToAdmins(orgId, msg.from, msg.pushName, result.reply, 'bot').catch(err => {
                    logger.error({ error: err.message }, 'Failed to forward bot reply to admins');
                });
            }

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

        this.logEvent('INBOUND_USER', msg.from, {
            tenantId: msg.tenantId,
            textPreview: msg.text.substring(0, 50),
            legacy: true,
        });

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

            const normalizedPhone = this.normalizePhone(phone);
            const mode = memoryStore.getMode(tenantId || 'default', normalizedPhone);
            const draft = memoryStore.getDraft(tenantId || 'default', normalizedPhone);

            return res.json({
                ok: true,
                phone: normalizedPhone,
                mode,
                hasDraft: !!draft,
                draftPreview: draft ? draft.substring(0, 100) : null,
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

            const normalizedPhone = this.normalizePhone(phone);
            await this.setModeWithLog(tenantId || 'default', normalizedPhone, mode as ConversationMode, 'api');

            return res.json({
                ok: true,
                phone: normalizedPhone,
                mode,
            });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }

    /**
     * Generate AI draft (API endpoint for Serapod UI)
     */
    async generateDraft(req: Request, res: Response) {
        try {
            const { tenantId, phone } = req.params;
            const { instruction } = req.body;

            if (!phone) {
                return res.status(400).json({ error: 'Missing phone' });
            }

            const normalizedPhone = this.normalizePhone(phone);

            // Generate draft
            const msg: InboundMsg = {
                tenantId: tenantId || 'default',
                from: normalizedPhone,
                text: '',
                timestamp: Date.now(),
            };

            const result = await aiService.processMessage(msg, instruction);

            // Store as draft
            memoryStore.setDraft(tenantId || 'default', normalizedPhone, result.reply);

            if (config.features.dbWrites) {
                const convResult = await supabaseService.findOrCreateConversation(normalizedPhone);
                if (convResult) {
                    await supabaseService.storeDraft(convResult.conversationId, result.reply);
                }
            }

            this.logEvent('DRAFT_CREATED', normalizedPhone, {
                tenantId: tenantId || 'default',
                draftPreview: result.reply.substring(0, 50),
                source: 'api',
            });

            return res.json({
                ok: true,
                phone: normalizedPhone,
                draft: result.reply,
            });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }

    /**
     * Send draft (API endpoint for Serapod UI)
     */
    async sendDraft(req: Request, res: Response) {
        try {
            const { tenantId, phone } = req.params;

            if (!phone) {
                return res.status(400).json({ error: 'Missing phone' });
            }

            const normalizedPhone = this.normalizePhone(phone);
            await this.sendPendingDraft(tenantId || 'default', normalizedPhone);

            return res.json({
                ok: true,
                phone: normalizedPhone,
            });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }
}

export const webhookHandler = new WebhookHandler();
