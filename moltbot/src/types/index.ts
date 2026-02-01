// src/types/index.ts

// ========== Gateway Event Types ==========

export type WebhookEventType = 'INBOUND_USER' | 'OUTBOUND_ADMIN';

/**
 * Raw webhook payload from baileys-gateway
 */
export interface GatewayWebhookPayload {
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
        gatewayPhone?: string; // The gateway's own WhatsApp number (for multi-tenant org resolution)
    };
}

// ========== Conversation Mode ==========

export type ConversationMode = 'auto' | 'takeover';

// ========== Command Types ==========

export type CommandType =
    | 'reply'      // /ai reply or /ai reply: <instruction>
    | 'draft'      // /ai draft
    | 'send'       // /ai send
    | 'auto_on'    // /ai auto on
    | 'auto_off'   // /ai auto off
    | 'summarize'  // /ai summarize
    | 'unknown';

export interface ParsedCommand {
    isCommand: boolean;
    type: CommandType;
    instruction?: string;      // For /ai reply: <instruction>
    rawText: string;
}

// ========== Message Sender Types ==========

export type SenderType = 'user' | 'admin' | 'bot' | 'system';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageChannel = 'app' | 'whatsapp' | 'admin_web' | 'ai';
export type MessageOrigin = 'serapod' | 'whatsapp';

/**
 * Normalized inbound message from WhatsApp
 */
export interface InboundMsg {
    tenantId: string;
    from: string; // E.164 digits only, e.g. "60192277233"
    text: string;
    messageId?: string;
    timestamp?: number;
    pushName?: string;
    rawPayload?: unknown;
}

/**
 * LLM message role
 */
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * LLM conversation message
 */
export interface LlmMessage {
    role: MessageRole;
    content: string;
    name?: string; // for tool results
    toolCallId?: string;
}

/**
 * Tool specification for LLM
 */
export interface ToolSpec {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * LLM chat input
 */
export interface LlmChatInput {
    system: string;
    messages: LlmMessage[];
    tools?: ToolSpec[];
}

/**
 * LLM chat result
 */
export interface LlmResult {
    content: string | null;
    toolCalls?: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * LLM client interface (pluggable)
 */
export interface LlmClient {
    chat(input: LlmChatInput): Promise<LlmResult>;
}

/**
 * User profile cached in memory
 */
export interface UserProfile {
    userId?: string;
    name?: string;
    phone: string;
    roles?: string[];
    foundAt: number;
}

/**
 * Conversation turn in memory
 */
export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    toolCalls?: ToolCall[];
}

/**
 * Conversation memory entry
 */
export interface ConversationMemory {
    tenantId: string;
    phone: string;
    userProfile?: UserProfile;
    turns: ConversationTurn[];
    lastUpdated: number;
    createdAt: number;
    // Mode state
    mode: ConversationMode;
    lastAdminActivityAt?: number;
    // Draft storage
    pendingDraft?: string;
    pendingDraftAt?: number;
}

/**
 * Tool registry definition
 */
export interface ToolDefinition {
    spec: ToolSpec;
    execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Tool execution context
 */
export interface ToolContext {
    phone: string;
    tenantId: string;
    userId?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

// ========== Serapod API Response Types ==========

export interface RecognizeUserResponse {
    found: boolean;
    userId?: string;
    name?: string;
    roles?: string[];
    phone?: string;
}

export interface GetPointsBalanceResponse {
    ok: boolean;
    userId?: string;
    balance: number;
    tier?: {
        name: string;
        multiplier: number;
        benefits?: string[];
    };
    nextTier?: {
        name: string;
        pointsNeeded: number;
    };
    lifetimeStats?: {
        earned: number;
        spent: number;
    };
    message?: string;
}

export interface OrderSummary {
    orderNo: string;
    status: string;
    totalAmount?: number;
    itemCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface GetRecentOrdersResponse {
    ok: boolean;
    userId?: string;
    orders: OrderSummary[];
    stats?: {
        total: number;
        pending: number;
        approved: number;
        shipped: number;
        delivered: number;
    };
    message?: string;
}

export interface RedemptionSummary {
    ref: string;
    itemName?: string;
    pointsUsed: number;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface GetRedeemStatusResponse {
    ok: boolean;
    userId?: string;
    redemptions: RedemptionSummary[];
    stats?: {
        total: number;
        pending: number;
        approved: number;
        shipped: number;
        delivered: number;
        totalPointsRedeemed: number;
    };
    currentBalance?: number;
    message?: string;
}

// ========== Support Thread Types (for DB writes) ==========

export interface SupportMessage {
    conversationId: string;
    direction: MessageDirection;
    channel: MessageChannel;
    senderType: SenderType;
    senderUserId?: string;
    senderAdminId?: string;
    senderPhone?: string;
    bodyText: string;
    externalMessageId?: string;
    externalChatId?: string;
    origin?: MessageOrigin;
    isSystem?: boolean;
    metadata?: Record<string, unknown>;
}
