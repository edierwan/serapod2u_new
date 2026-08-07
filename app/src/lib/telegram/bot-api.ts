import { getTelegramBotToken } from '@/lib/telegram/constants'

export interface SendTelegramMessageOptions {
  chatId: number | string
  text: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  disableWebPagePreview?: boolean
  replyMarkup?: {
    inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>
  }
}

export class TelegramBotError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'TelegramBotError'
  }
}

export async function sendTelegramMessage(options: SendTelegramMessageOptions): Promise<void> {
  const token = getTelegramBotToken()
  if (!token) {
    throw new TelegramBotError('TELEGRAM_BOT_TOKEN is not configured.')
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: options.chatId,
      text: options.text,
      parse_mode: options.parseMode,
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      reply_markup: options.replyMarkup,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new TelegramBotError(
      body || `Telegram sendMessage failed (${response.status})`,
      response.status,
    )
  }
}

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
