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

export interface TelegramFileDescriptor {
  file_id: string
  file_unique_id: string
  file_size?: number
  width?: number
  height?: number
}

export async function getTelegramFilePath(fileId: string): Promise<string> {
  const token = getTelegramBotToken()
  if (!token) throw new TelegramBotError('TELEGRAM_BOT_TOKEN is not configured.')

  const response = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)
  if (!response.ok) {
    throw new TelegramBotError(`Telegram getFile failed (${response.status})`, response.status)
  }
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { file_path?: string } }
  if (!payload?.ok || !payload.result?.file_path) {
    throw new TelegramBotError('Telegram getFile returned no file_path')
  }
  return payload.result.file_path
}

export async function downloadTelegramFile(filePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = getTelegramBotToken()
  if (!token) throw new TelegramBotError('TELEGRAM_BOT_TOKEN is not configured.')

  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
  if (!response.ok) {
    throw new TelegramBotError(`Telegram file download failed (${response.status})`, response.status)
  }
  const arrayBuffer = await response.arrayBuffer()
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  return { buffer: Buffer.from(arrayBuffer), mimeType }
}

export function inferTelegramPhotoMime(filePath: string, fallback = 'image/jpeg'): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return fallback
}
