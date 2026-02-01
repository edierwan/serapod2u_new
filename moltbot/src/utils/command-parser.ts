// src/utils/command-parser.ts
import { ParsedCommand, CommandType } from '../types';
import { logger } from './logger';

/**
 * Command prefixes that trigger bot commands
 */
const COMMAND_PREFIXES = ['/ai', '!ai', '/bot', '!bot'];

/**
 * Parse admin message for bot commands
 * 
 * Supported commands:
 * - /ai reply           - Generate and send AI reply
 * - /ai reply: <instr>  - Generate reply with instruction
 * - /ai draft           - Generate draft (don't send)
 * - /ai send            - Send pending draft
 * - /ai auto on         - Enable auto mode
 * - /ai auto off        - Disable auto mode (takeover)
 * - /ai summarize       - Summarize conversation
 */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const lowerText = trimmed.toLowerCase();
  
  // Check if message starts with a command prefix
  const matchedPrefix = COMMAND_PREFIXES.find(p => lowerText.startsWith(p));
  
  if (!matchedPrefix) {
    return {
      isCommand: false,
      type: 'unknown',
      rawText: trimmed,
    };
  }
  
  // Extract the part after the prefix
  const afterPrefix = trimmed.substring(matchedPrefix.length).trim();
  const afterPrefixLower = afterPrefix.toLowerCase();
  
  logger.debug({ 
    prefix: matchedPrefix, 
    afterPrefix 
  }, 'Parsing command');
  
  // Check for specific commands
  
  // /ai auto on
  if (afterPrefixLower === 'auto on') {
    return {
      isCommand: true,
      type: 'auto_on',
      rawText: trimmed,
    };
  }
  
  // /ai auto off
  if (afterPrefixLower === 'auto off') {
    return {
      isCommand: true,
      type: 'auto_off',
      rawText: trimmed,
    };
  }
  
  // /ai summarize
  if (afterPrefixLower === 'summarize' || afterPrefixLower === 'summary') {
    return {
      isCommand: true,
      type: 'summarize',
      rawText: trimmed,
    };
  }
  
  // /ai draft
  if (afterPrefixLower === 'draft') {
    return {
      isCommand: true,
      type: 'draft',
      rawText: trimmed,
    };
  }
  
  // /ai send
  if (afterPrefixLower === 'send') {
    return {
      isCommand: true,
      type: 'send',
      rawText: trimmed,
    };
  }
  
  // /ai reply or /ai reply: <instruction>
  if (afterPrefixLower.startsWith('reply')) {
    // Check for instruction after colon
    const replyMatch = afterPrefix.match(/^reply\s*:?\s*(.*)$/i);
    const instruction = replyMatch?.[1]?.trim() || undefined;
    
    return {
      isCommand: true,
      type: 'reply',
      instruction: instruction || undefined,
      rawText: trimmed,
    };
  }
  
  // Just the prefix alone (e.g., "/ai") - treat as reply
  if (!afterPrefix) {
    return {
      isCommand: true,
      type: 'reply',
      rawText: trimmed,
    };
  }
  
  // Unknown command after prefix
  return {
    isCommand: true,
    type: 'unknown',
    rawText: trimmed,
  };
}

/**
 * Check if text is a command (quick check)
 */
export function isCommand(text: string): boolean {
  const lowerText = text.trim().toLowerCase();
  return COMMAND_PREFIXES.some(p => lowerText.startsWith(p));
}

/**
 * Get human-readable command description
 */
export function getCommandDescription(type: CommandType): string {
  switch (type) {
    case 'reply':
      return 'Generate AI Reply';
    case 'draft':
      return 'Generate AI Draft';
    case 'send':
      return 'Send Pending Draft';
    case 'auto_on':
      return 'Enable Auto Mode';
    case 'auto_off':
      return 'Disable Auto Mode';
    case 'summarize':
      return 'Summarize Conversation';
    default:
      return 'Unknown Command';
  }
}
