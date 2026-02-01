// src/config.ts
import dotenv from 'dotenv';
dotenv.config();

export type LlmProvider = 'openai' | 'gemini' | 'mock';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '4000', 10),
  webhookSecret: process.env.MOLTBOT_WEBHOOK_SECRET || 'secret',
  debugSecret: process.env.MOLTBOT_DEBUG_SECRET || process.env.MOLTBOT_WEBHOOK_SECRET || 'debug-secret',
  
  // Gateway (Baileys)
  gateway: {
    url: process.env.BAILEYS_GATEWAY_URL || 'https://wa.serapod2u.com',
    apiKey: process.env.SERAPOD_WA_API_KEY || '',
  },
  
  // LLM Provider
  llm: {
    provider: (process.env.LLM_PROVIDER || process.env.BOT_PROVIDER || 'openai') as LlmProvider,
    openai: {
      apiKey: process.env.OPENAI_API_KEY || process.env.BOT_API_KEY || '',
      model: process.env.OPENAI_MODEL || process.env.BOT_MODEL || 'gpt-4o-mini',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || process.env.BOT_API_KEY || '',
      model: process.env.GEMINI_MODEL || process.env.BOT_MODEL || 'gemini-1.5-flash',
    },
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '500', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    safeMode: process.env.BOT_SAFE_MODE !== 'false', // default: true
  },
  
  // Serapod API
  serapod: {
    baseUrl: process.env.SERAPOD_BASE_URL || 'https://dev.serapod2u.com',
    serviceToken: process.env.SERAPOD_SERVICE_TOKEN || process.env.AGENT_API_KEY || '',
    tenantId: process.env.SERAPOD_TENANT_ID || 'default',
    timeout: parseInt(process.env.SERAPOD_TIMEOUT || '10000', 10),
  },
  
  // Supabase (for direct DB access)
  supabase: {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  
  // Conversation Memory
  memory: {
    maxTurns: parseInt(process.env.MEMORY_MAX_TURNS || '10', 10),
    ttlMs: parseInt(process.env.MEMORY_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days
    cleanupIntervalMs: parseInt(process.env.MEMORY_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10), // 1 hour
  },
  
  // Feature flags
  features: {
    autoReply: process.env.MOLTBOT_AUTO_REPLY !== 'false', // default: true
    toolCalling: process.env.MOLTBOT_TOOL_CALLING !== 'false', // default: true
    greeting: process.env.MOLTBOT_GREETING !== 'false', // default: true
    dbWrites: process.env.MOLTBOT_DB_WRITES !== 'false', // default: true
  },
  
  // Bot personality
  bot: {
    name: process.env.BOT_NAME || 'Serapod Bot',
    language: process.env.BOT_LANGUAGE || 'ms', // Malay
    systemPrompt: process.env.BOT_SYSTEM_PROMPT || '',
  },
  
  // Takeover settings
  takeover: {
    // Auto-revert to auto mode after X ms of admin inactivity (0 = never)
    autoRevertMs: parseInt(process.env.TAKEOVER_AUTO_REVERT_MS || '0', 10),
  },
};
