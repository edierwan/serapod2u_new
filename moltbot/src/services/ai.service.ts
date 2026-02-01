// src/services/ai.service.ts
import { logger } from '../utils/logger';
import { config } from '../config';
import { getLlmClient } from '../providers/llm';
import { getAllToolSpecs, executeTool } from '../tools/registry';
import { memoryStore } from './memory';
import { serapodClient } from './serapod.client';
import { getSystemPrompt, getErrorMessage } from '../prompts/system';
import {
  InboundMsg,
  LlmMessage,
  LlmResult,
  ToolCall,
  ToolContext,
  UserProfile,
} from '../types';

const MAX_TOOL_ITERATIONS = 5; // Prevent infinite loops

interface ChatResult {
  reply: string;
  toolCalls?: ToolCall[];
  userProfile?: UserProfile;
  error?: string;
}

class AIService {
  /**
   * Process an inbound message and generate AI reply
   * @param msg The inbound message
   * @param instruction Optional instruction for commanded replies (e.g., "be more formal")
   */
  async processMessage(msg: InboundMsg, instruction?: string): Promise<ChatResult> {
    const startTime = Date.now();
    const { tenantId, from: phone, text, pushName } = msg;
    
    logger.info({
      tenantId,
      phone,
      textPreview: text.substring(0, 50),
      pushName,
      hasInstruction: !!instruction,
    }, 'Processing inbound message');

    try {
      // 1. Get or create memory
      const memory = memoryStore.getOrCreate(tenantId, phone);
      
      // 2. Try to recognize user if not cached
      let userProfile = memory.userProfile;
      
      if (!userProfile && config.features.toolCalling) {
        const recognized = await serapodClient.recognizeUser(phone);
        
        if (recognized.found) {
          userProfile = {
            userId: recognized.userId,
            name: recognized.name || pushName,
            phone,
            roles: recognized.roles,
            foundAt: Date.now(),
          };
          memoryStore.setUserProfile(tenantId, phone, userProfile);
          logger.info({ phone, name: userProfile.name }, 'User recognized');
        } else if (pushName) {
          // Use push name if available
          userProfile = {
            name: pushName,
            phone,
            foundAt: Date.now(),
          };
          memoryStore.setUserProfile(tenantId, phone, userProfile);
        }
      }

      // 3. Add user turn to memory (only if there's actual text)
      if (text && text.trim()) {
        memoryStore.addTurn(tenantId, phone, 'user', text);
      }

      // 4. Build LLM messages from memory
      const recentTurns = memoryStore.getRecentTurns(tenantId, phone);
      const messages: LlmMessage[] = recentTurns.map(turn => ({
        role: turn.role,
        content: turn.content,
      }));

      // 5. Get LLM client and tool specs
      const llm = getLlmClient();
      const tools = config.features.toolCalling ? getAllToolSpecs() : [];

      // 6. Build system prompt (with optional instruction)
      let systemPrompt = getSystemPrompt(userProfile?.name);
      
      // Add instruction context if provided
      if (instruction) {
        systemPrompt += `\n\n[ADMIN INSTRUCTION]: ${instruction}\nFollow this instruction when crafting your response.`;
      }

      // For commanded replies without new user text, add context
      if (!text || !text.trim()) {
        const lastUserMsg = recentTurns.filter(t => t.role === 'user').pop();
        if (lastUserMsg) {
          // Don't add duplicate - just ensure we have context
          systemPrompt += `\n\n[CONTEXT]: Generate a reply to the user's last message.`;
        }
      }

      // 7. Chat with LLM (with tool call loop)
      let result: LlmResult;
      let allToolCalls: ToolCall[] = [];
      let iterations = 0;
      let currentMessages = [...messages];

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        
        result = await llm.chat({
          system: systemPrompt,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
        });

        // If no tool calls, we're done
        if (!result.toolCalls || result.toolCalls.length === 0) {
          break;
        }

        // Process tool calls
        logger.info({
          iteration: iterations,
          toolCalls: result.toolCalls.map(tc => tc.name),
        }, 'Processing tool calls');

        // Build tool context
        const toolContext: ToolContext = {
          phone,
          tenantId,
          userId: userProfile?.userId,
        };

        // Execute each tool call
        for (const toolCall of result.toolCalls) {
          allToolCalls.push(toolCall);
          
          const toolResult = await executeTool(
            toolCall.name,
            toolCall.arguments,
            toolContext
          );

          // Add tool result to messages
          currentMessages.push({
            role: 'assistant',
            content: '',
            toolCallId: toolCall.id,
          });
          currentMessages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            name: toolCall.name,
            toolCallId: toolCall.id,
          });
        }
      }

      // 8. Get final reply
      const reply = result!.content || getErrorMessage('unknown_error');

      // 9. Add assistant turn to memory
      memoryStore.addTurn(tenantId, phone, 'assistant', reply, allToolCalls);

      const duration = Date.now() - startTime;
      logger.info({
        phone,
        replyPreview: reply.substring(0, 50),
        toolCallCount: allToolCalls.length,
        hasInstruction: !!instruction,
        durationMs: duration,
      }, 'Message processed successfully');

      return {
        reply,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        userProfile,
      };

    } catch (error: any) {
      logger.error({
        phone,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
      }, 'Message processing failed');

      return {
        reply: getErrorMessage('unknown_error'),
        error: error.message,
      };
    }
  }

  /**
   * Generate a conversation summary
   */
  async generateSummary(tenantId: string, phone: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      // Get conversation history
      const recentTurns = memoryStore.getRecentTurns(tenantId, phone, 20);
      
      if (recentTurns.length === 0) {
        return 'No conversation history available.';
      }

      // Build messages for summary
      const messages: LlmMessage[] = recentTurns.map(turn => ({
        role: turn.role,
        content: turn.content,
      }));

      // Add summary request
      messages.push({
        role: 'user',
        content: 'Please provide a concise summary of this conversation in Bahasa Malaysia. Include key topics, any issues raised, and current status.',
      });

      // Get LLM client
      const llm = getLlmClient();

      // Generate summary
      const result = await llm.chat({
        system: 'You are a helpful assistant that summarizes customer support conversations. Respond in Bahasa Malaysia with a brief, actionable summary.',
        messages,
      });

      const summary = result.content || 'Unable to generate summary.';

      logger.info({
        tenantId,
        phone,
        turnCount: recentTurns.length,
        durationMs: Date.now() - startTime,
      }, 'Summary generated');

      return summary;

    } catch (error: any) {
      logger.error({
        tenantId,
        phone,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Summary generation failed');

      return `Error generating summary: ${error.message}`;
    }
  }

  /**
   * Generate a simple greeting
   */
  generateGreeting(name?: string): string {
    if (name) {
      return `Hi ${name}! 👋 Ada apa boleh saya bantu hari ni?`;
    }
    return `Hi! 👋 Selamat datang ke Serapod2u. Ada apa boleh saya bantu?`;
  }

  /**
   * Clear conversation memory for a user
   */
  clearMemory(tenantId: string, phone: string): boolean {
    return memoryStore.clear(tenantId, phone);
  }
}

// Singleton instance
export const aiService = new AIService();
