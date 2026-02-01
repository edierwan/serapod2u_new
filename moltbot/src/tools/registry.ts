// src/tools/registry.ts
import { logger } from '../utils/logger';
import { serapodClient } from '../services/serapod.client';
import {
  ToolSpec,
  ToolDefinition,
  ToolContext,
  ToolResult,
} from '../types';

// ========== Tool Definitions ==========

/**
 * recognize_user - Identify user by phone number
 */
const recognizeUser: ToolDefinition = {
  spec: {
    name: 'recognize_user',
    description: 'Identify a user by their phone number. Returns user ID, name, and roles if found.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Phone number to look up (any format, will be normalized)',
        },
      },
      required: ['phone'],
    },
  },
  async execute(args, context): Promise<ToolResult> {
    const phone = (args.phone as string) || context.phone;
    
    try {
      const result = await serapodClient.recognizeUser(phone);
      
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      logger.error({ tool: 'recognize_user', phone, error: error.message }, 'Tool execution failed');
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * get_points_balance - Get user's points balance
 */
const getPointsBalance: ToolDefinition = {
  spec: {
    name: 'get_points_balance',
    description: 'Get the user\'s current points balance, tier, and recent transaction summary.',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (UUID). Optional if phone is provided.',
        },
        phone: {
          type: 'string',
          description: 'Phone number. Optional if userId is provided.',
        },
      },
    },
  },
  async execute(args, context): Promise<ToolResult> {
    const userId = (args.userId as string) || context.userId;
    const phone = (args.phone as string) || context.phone;
    
    try {
      const result = await serapodClient.getPointsBalance({ userId, phone });
      
      if (!result.ok && result.message === 'User not found') {
        return {
          success: true,
          data: {
            found: false,
            message: 'User not found in the system',
          },
        };
      }
      
      return {
        success: result.ok,
        data: result,
        error: result.ok ? undefined : result.message,
      };
    } catch (error: any) {
      logger.error({ tool: 'get_points_balance', userId, phone, error: error.message }, 'Tool execution failed');
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * get_recent_orders - Get user's recent orders
 */
const getRecentOrders: ToolDefinition = {
  spec: {
    name: 'get_recent_orders',
    description: 'Get the user\'s recent orders with status. Default limit is 5.',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (UUID). Optional if phone is provided.',
        },
        phone: {
          type: 'string',
          description: 'Phone number. Optional if userId is provided.',
        },
        limit: {
          type: 'string',
          description: 'Maximum number of orders to return (default: 5)',
        },
      },
    },
  },
  async execute(args, context): Promise<ToolResult> {
    const userId = (args.userId as string) || context.userId;
    const phone = (args.phone as string) || context.phone;
    const limit = parseInt((args.limit as string) || '5', 10);
    
    try {
      const result = await serapodClient.getRecentOrders({ userId, phone, limit });
      
      if (!result.ok && result.message === 'User not found') {
        return {
          success: true,
          data: {
            found: false,
            message: 'User not found in the system',
          },
        };
      }
      
      return {
        success: result.ok,
        data: result,
        error: result.ok ? undefined : result.message,
      };
    } catch (error: any) {
      logger.error({ tool: 'get_recent_orders', userId, phone, error: error.message }, 'Tool execution failed');
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * get_redeem_status - Get user's redemption status
 */
const getRedeemStatus: ToolDefinition = {
  spec: {
    name: 'get_redeem_status',
    description: 'Get the user\'s redemption history and status. Default limit is 5.',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID (UUID). Optional if phone is provided.',
        },
        phone: {
          type: 'string',
          description: 'Phone number. Optional if userId is provided.',
        },
        limit: {
          type: 'string',
          description: 'Maximum number of redemptions to return (default: 5)',
        },
      },
    },
  },
  async execute(args, context): Promise<ToolResult> {
    const userId = (args.userId as string) || context.userId;
    const phone = (args.phone as string) || context.phone;
    const limit = parseInt((args.limit as string) || '5', 10);
    
    try {
      const result = await serapodClient.getRedeemStatus({ userId, phone, limit });
      
      if (!result.ok && result.message === 'User not found') {
        return {
          success: true,
          data: {
            found: false,
            message: 'User not found in the system',
          },
        };
      }
      
      return {
        success: result.ok,
        data: result,
        error: result.ok ? undefined : result.message,
      };
    } catch (error: any) {
      logger.error({ tool: 'get_redeem_status', userId, phone, error: error.message }, 'Tool execution failed');
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

// ========== Tool Registry ==========

const toolRegistry: Map<string, ToolDefinition> = new Map([
  ['recognize_user', recognizeUser],
  ['get_points_balance', getPointsBalance],
  ['get_recent_orders', getRecentOrders],
  ['get_redeem_status', getRedeemStatus],
]);

/**
 * Get all available tools specs for LLM
 */
export function getAllToolSpecs(): ToolSpec[] {
  return Array.from(toolRegistry.values()).map(t => t.spec);
}

/**
 * Get a tool by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  
  if (!tool) {
    logger.warn({ tool: name }, 'Tool not found');
    return {
      success: false,
      error: `Tool '${name}' not found`,
    };
  }
  
  const startTime = Date.now();
  
  try {
    const result = await tool.execute(args, context);
    
    logger.info({
      tool: name,
      args,
      success: result.success,
      durationMs: Date.now() - startTime,
    }, 'Tool executed');
    
    return result;
  } catch (error: any) {
    logger.error({
      tool: name,
      args,
      error: error.message,
      durationMs: Date.now() - startTime,
    }, 'Tool execution error');
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List all registered tools
 */
export function listTools(): string[] {
  return Array.from(toolRegistry.keys());
}
