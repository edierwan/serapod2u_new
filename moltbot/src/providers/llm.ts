// src/providers/llm.ts
import OpenAI from 'openai';
import { GoogleGenerativeAI, GenerativeModel, Content, Part } from '@google/generative-ai';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  LlmClient,
  LlmChatInput,
  LlmResult,
  ToolSpec,
  ToolCall,
  LlmMessage,
} from '../types';

// ========== OpenAI Provider ==========

class OpenAIProvider implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.llm.openai.apiKey,
    });
    this.model = config.llm.openai.model;
    logger.info({ provider: 'openai', model: this.model }, 'OpenAI LLM provider initialized');
  }

  async chat(input: LlmChatInput): Promise<LlmResult> {
    const startTime = Date.now();
    
    try {
      // Build messages array
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      
      // Add system prompt
      if (input.system) {
        messages.push({ role: 'system', content: input.system });
      }
      
      // Add conversation messages
      for (const msg of input.messages) {
        if (msg.role === 'user') {
          messages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          messages.push({ role: 'assistant', content: msg.content });
        } else if (msg.role === 'tool' && msg.toolCallId) {
          messages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId,
            content: msg.content,
          });
        }
      }

      // Build tools array
      const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = input.tools?.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        max_tokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
      });

      const choice = response.choices[0];
      const message = choice.message;
      const duration = Date.now() - startTime;

      logger.info({
        provider: 'openai',
        model: this.model,
        finishReason: choice.finish_reason,
        durationMs: duration,
        usage: response.usage,
      }, 'OpenAI chat completed');

      // Extract tool calls if present
      const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(tc => {
        // Type guard for function tool calls
        const funcCall = 'function' in tc ? tc.function : null;
        return {
          id: tc.id,
          name: funcCall?.name || 'unknown',
          arguments: funcCall?.arguments ? JSON.parse(funcCall.arguments) : {},
        };
      });

      return {
        content: message.content,
        toolCalls,
        finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 
                      choice.finish_reason === 'length' ? 'length' : 'stop',
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      };
    } catch (error: any) {
      logger.error({ provider: 'openai', error: error.message }, 'OpenAI chat failed');
      return {
        content: null,
        finishReason: 'error',
      };
    }
  }
}

// ========== Gemini Provider ==========

class GeminiProvider implements LlmClient {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;

  constructor() {
    this.client = new GoogleGenerativeAI(config.llm.gemini.apiKey);
    this.modelName = config.llm.gemini.model;
    this.model = this.client.getGenerativeModel({ model: this.modelName });
    logger.info({ provider: 'gemini', model: this.modelName }, 'Gemini LLM provider initialized');
  }

  private convertToolsToGemini(tools: ToolSpec[]) {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    }];
  }

  async chat(input: LlmChatInput): Promise<LlmResult> {
    const startTime = Date.now();
    
    try {
      // Build contents array for Gemini
      const contents: Content[] = [];
      
      // Add conversation messages
      for (const msg of input.messages) {
        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }],
          });
        } else if (msg.role === 'assistant') {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }],
          });
        } else if (msg.role === 'tool') {
          // Gemini handles tool results differently
          contents.push({
            role: 'function',
            parts: [{
              functionResponse: {
                name: msg.name || 'tool_result',
                response: { result: msg.content },
              },
            }] as Part[],
          });
        }
      }

      // Create chat session with system instruction and tools
      const chatConfig: any = {
        systemInstruction: input.system ? { parts: [{ text: input.system }] } : undefined,
        generationConfig: {
          maxOutputTokens: config.llm.maxTokens,
          temperature: config.llm.temperature,
        },
      };

      if (input.tools && input.tools.length > 0) {
        chatConfig.tools = this.convertToolsToGemini(input.tools);
      }

      const chat = this.model.startChat({
        ...chatConfig,
        history: contents.slice(0, -1),
      });

      // Get last user message
      const lastMessage = contents[contents.length - 1];
      const userText = lastMessage?.parts?.[0] && 'text' in lastMessage.parts[0] 
        ? lastMessage.parts[0].text 
        : '';

      // Ensure we have a message to send
      if (!userText) {
        return {
          content: null,
          finishReason: 'error',
        };
      }

      const response = await chat.sendMessage(userText);
      const result = response.response;
      const duration = Date.now() - startTime;

      logger.info({
        provider: 'gemini',
        model: this.modelName,
        durationMs: duration,
      }, 'Gemini chat completed');

      // Extract tool calls if present
      const functionCalls = result.functionCalls();
      const toolCalls: ToolCall[] | undefined = functionCalls?.map((fc, idx) => ({
        id: `gemini-${Date.now()}-${idx}`,
        name: fc.name,
        arguments: fc.args as Record<string, unknown>,
      }));

      const textContent = result.text();

      return {
        content: textContent || null,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } catch (error: any) {
      logger.error({ provider: 'gemini', error: error.message }, 'Gemini chat failed');
      return {
        content: null,
        finishReason: 'error',
      };
    }
  }
}

// ========== Factory ==========

let llmClientInstance: LlmClient | null = null;

export function getLlmClient(): LlmClient {
  if (llmClientInstance) {
    return llmClientInstance;
  }

  const provider = config.llm.provider;

  if (provider === 'gemini') {
    if (!config.llm.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
    }
    llmClientInstance = new GeminiProvider();
  } else {
    // Default to OpenAI
    if (!config.llm.openai.apiKey) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
    }
    llmClientInstance = new OpenAIProvider();
  }

  return llmClientInstance;
}

// Export for testing
export { OpenAIProvider, GeminiProvider };
