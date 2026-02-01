// src/types/index.ts

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
