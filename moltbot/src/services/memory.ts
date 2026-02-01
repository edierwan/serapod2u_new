// src/services/memory.ts
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  ConversationMemory,
  ConversationTurn,
  UserProfile,
  ToolCall,
} from '../types';

/**
 * In-memory conversation store
 * Key format: {tenantId}:{phone}
 */
class MemoryStore {
  private store: Map<string, ConversationMemory> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanup();
    logger.info({
      maxTurns: config.memory.maxTurns,
      ttlMs: config.memory.ttlMs,
    }, 'Memory store initialized');
  }

  /**
   * Generate store key from tenant and phone
   */
  private makeKey(tenantId: string, phone: string): string {
    return `${tenantId}:${phone}`;
  }

  /**
   * Normalize phone to digits only
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '60' + cleaned.substring(1);
    }
    return cleaned;
  }

  /**
   * Get conversation memory for a user
   */
  get(tenantId: string, phone: string): ConversationMemory | null {
    const key = this.makeKey(tenantId, this.normalizePhone(phone));
    const memory = this.store.get(key);
    
    if (!memory) {
      return null;
    }
    
    // Check TTL
    if (Date.now() - memory.lastUpdated > config.memory.ttlMs) {
      this.store.delete(key);
      logger.debug({ key }, 'Memory expired and deleted');
      return null;
    }
    
    return memory;
  }

  /**
   * Get or create conversation memory
   */
  getOrCreate(tenantId: string, phone: string): ConversationMemory {
    const normalizedPhone = this.normalizePhone(phone);
    const existing = this.get(tenantId, normalizedPhone);
    
    if (existing) {
      return existing;
    }
    
    const key = this.makeKey(tenantId, normalizedPhone);
    const now = Date.now();
    
    const memory: ConversationMemory = {
      tenantId,
      phone: normalizedPhone,
      turns: [],
      lastUpdated: now,
      createdAt: now,
    };
    
    this.store.set(key, memory);
    logger.debug({ key }, 'New memory created');
    
    return memory;
  }

  /**
   * Update user profile in memory
   */
  setUserProfile(tenantId: string, phone: string, profile: UserProfile): void {
    const memory = this.getOrCreate(tenantId, phone);
    memory.userProfile = profile;
    memory.lastUpdated = Date.now();
    
    const key = this.makeKey(tenantId, this.normalizePhone(phone));
    this.store.set(key, memory);
    
    logger.debug({ key, profile }, 'User profile updated');
  }

  /**
   * Add a turn to conversation
   */
  addTurn(
    tenantId: string,
    phone: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls?: ToolCall[]
  ): void {
    const memory = this.getOrCreate(tenantId, phone);
    
    const turn: ConversationTurn = {
      role,
      content,
      timestamp: Date.now(),
      toolCalls,
    };
    
    memory.turns.push(turn);
    
    // Trim to max turns
    while (memory.turns.length > config.memory.maxTurns) {
      memory.turns.shift();
    }
    
    memory.lastUpdated = Date.now();
    
    const key = this.makeKey(tenantId, this.normalizePhone(phone));
    this.store.set(key, memory);
    
    logger.debug({
      key,
      role,
      turnCount: memory.turns.length,
    }, 'Turn added');
  }

  /**
   * Get recent turns for LLM context
   */
  getRecentTurns(tenantId: string, phone: string, limit?: number): ConversationTurn[] {
    const memory = this.get(tenantId, phone);
    
    if (!memory) {
      return [];
    }
    
    const maxTurns = limit || config.memory.maxTurns;
    return memory.turns.slice(-maxTurns);
  }

  /**
   * Get user profile from memory
   */
  getUserProfile(tenantId: string, phone: string): UserProfile | undefined {
    const memory = this.get(tenantId, phone);
    return memory?.userProfile;
  }

  /**
   * Clear memory for a user
   */
  clear(tenantId: string, phone: string): boolean {
    const key = this.makeKey(tenantId, this.normalizePhone(phone));
    const deleted = this.store.delete(key);
    
    if (deleted) {
      logger.debug({ key }, 'Memory cleared');
    }
    
    return deleted;
  }

  /**
   * Get memory stats
   */
  getStats(): { totalConversations: number; oldestMs: number | null; newestMs: number | null } {
    let oldest: number | null = null;
    let newest: number | null = null;
    
    for (const memory of this.store.values()) {
      if (oldest === null || memory.createdAt < oldest) {
        oldest = memory.createdAt;
      }
      if (newest === null || memory.lastUpdated > newest) {
        newest = memory.lastUpdated;
      }
    }
    
    return {
      totalConversations: this.store.size,
      oldestMs: oldest,
      newestMs: newest,
    };
  }

  /**
   * Get debug info for a phone (redacted)
   */
  getDebugInfo(tenantId: string, phone: string): object | null {
    const memory = this.get(tenantId, phone);
    
    if (!memory) {
      return null;
    }
    
    return {
      phone: memory.phone,
      userProfile: memory.userProfile ? {
        name: memory.userProfile.name,
        hasUserId: !!memory.userProfile.userId,
        roles: memory.userProfile.roles,
      } : null,
      turnCount: memory.turns.length,
      recentTurns: memory.turns.slice(-3).map(t => ({
        role: t.role,
        contentPreview: t.content.substring(0, 50) + (t.content.length > 50 ? '...' : ''),
        hasToolCalls: !!t.toolCalls?.length,
        timestamp: new Date(t.timestamp).toISOString(),
      })),
      createdAt: new Date(memory.createdAt).toISOString(),
      lastUpdated: new Date(memory.lastUpdated).toISOString(),
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, memory] of this.store.entries()) {
      if (now - memory.lastUpdated > config.memory.ttlMs) {
        this.store.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info({ cleaned, remaining: this.store.size }, 'Memory cleanup completed');
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, config.memory.cleanupIntervalMs);
    
    // Allow process to exit even if timer is running
    this.cleanupTimer.unref();
  }

  /**
   * Stop cleanup timer (for graceful shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Singleton instance
export const memoryStore = new MemoryStore();
