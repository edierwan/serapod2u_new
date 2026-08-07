/**
 * Official Serapod distributor ordering via Telegram (@SerapodOrdersBot).
 *
 * Required env (live messaging):
 *   TELEGRAM_BOT_TOKEN       — from @BotFather
 *   TELEGRAM_BOT_USERNAME    — without @ (SerapodOrdersBot)
 *
 * Optional:
 *   TELEGRAM_WEBHOOK_SECRET  — set on setWebhook; validated via X-Telegram-Bot-Api-Secret-Token
 */

export const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 15
export const TELEGRAM_LINK_TOKEN_LENGTH = 8
export const TELEGRAM_SESSION_MAX_PASTE_CHARS = 8000

export const TELEGRAM_COMMANDS = {
  START: '/start',
  LINK: '/link',
  HELP: '/help',
  CHECK: '/check',
  CONFIRM: '/confirm',
  CANCEL: '/cancel',
  STATUS: '/status',
} as const

export function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  return token || null
}

export function getTelegramBotUsername(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
  return username || null
}

export function getTelegramWebhookSecret(): string | null {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  return secret || null
}

export function buildTelegramDeepLink(token: string): string | null {
  const username = getTelegramBotUsername()
  if (!username) return null
  return `https://t.me/${username}?start=${encodeURIComponent(token)}`
}
