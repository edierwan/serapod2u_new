// src/config.ts
import dotenv from 'dotenv';
dotenv.config();

export type LlmProvider = 'openai' | 'gemini' | 'mock';

/**
 * Parse comma-separated phone numbers into normalized format
 */
function parsePhoneList(envValue: string | undefined): string[] {
    if (!envValue) return [];
    return envValue
        .split(',')
        .map(p => p.trim().replace(/\D/g, ''))
        .filter(p => p.length >= 10)
        .map(p => p.startsWith('0') ? '60' + p.substring(1) : p);
}

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

    // Admin WhatsApp numbers (DEPRECATED - now managed in DB via whatsapp_bot_admins table)
    // This is kept as FALLBACK ONLY for backwards compatibility
    // Use the Serapod admin UI to manage bot admins dynamically
    // Comma-separated: ADMIN_WA_NUMBERS=60192277233,60123456789
    adminPhones: parsePhoneList(process.env.ADMIN_WA_NUMBERS),

    // Default org_id for fallback when org cannot be resolved from gateway
    defaultOrgId: process.env.DEFAULT_ORG_ID || null,

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
        // Safety mode: only read-only tools by default
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
        // Default: 30 minutes
        autoRevertMs: parseInt(process.env.TAKEOVER_AUTO_REVERT_MS || '1800000', 10),
    },
};

/**
 * Check if a phone number belongs to an admin
 */
export function isAdminPhone(phone: string): boolean {
    if (config.adminPhones.length === 0) return false;
    const normalized = phone.replace(/\D/g, '');
    const withPrefix = normalized.startsWith('0') ? '60' + normalized.substring(1) : normalized;
    return config.adminPhones.includes(withPrefix);
}
