import { randomUUID } from 'crypto'
import {
  TELEGRAM_COMMANDS,
  TELEGRAM_SESSION_MAX_PASTE_CHARS,
} from '@/lib/telegram/constants'
import { escapeTelegramHtml, sendTelegramMessage } from '@/lib/telegram/bot-api'
import {
  consumeTelegramLinkToken,
  getTelegramLinkByTelegramUserId,
  updateTelegramSession,
} from '@/lib/telegram/link-service'
import {
  formatTelegramCheckReply,
  formatTelegramConfirmReply,
  runTelegramConfirmOrder,
  runTelegramPasteCheck,
} from '@/lib/telegram/order-actions'
import type { TelegramMessage, TelegramSessionJson } from '@/lib/telegram/types'

function parseCommand(text: string): { command: string; args: string } {
  const trimmed = text.trim()
  const space = trimmed.indexOf(' ')
  if (space === -1) return { command: trimmed.toLowerCase(), args: '' }
  return {
    command: trimmed.slice(0, space).toLowerCase(),
    args: trimmed.slice(space + 1).trim(),
  }
}

async function reply(chatId: number, text: string): Promise<void> {
  await sendTelegramMessage({ chatId, text, parseMode: 'HTML' })
}

async function sendHelp(chatId: number, linked: boolean): Promise<void> {
  const lines = [
    '<b>Serapod Orders</b> — official ordering channel',
    linked ? 'Account: linked ✓' : 'Account: not linked — open portal → Telegram and generate a link code.',
    '',
    'Paste your order list as a message to Check stock.',
    '',
    '<b>Commands</b>',
    '/check — re-check the last pasted list',
    '/confirm — submit the last checked list',
    '/cancel — clear draft',
    '/status — link + draft status',
    '/link CODE — link Serapod account',
    '/help — this message',
  ]
  await reply(chatId, lines.join('\n'))
}

async function handleLink(
  chatId: number,
  telegramUserId: number,
  code: string,
  from?: TelegramMessage['from'],
): Promise<void> {
  if (!code) {
    await reply(chatId, 'Send <code>/link YOUR_CODE</code> from Serapp → Telegram.')
    return
  }

  try {
    const link = await consumeTelegramLinkToken({
      token: code,
      telegramUserId,
      telegramChatId: chatId,
      telegramUsername: from?.username,
      telegramFirstName: from?.first_name,
    })

    await reply(
      chatId,
      [
        '<b>Linked successfully</b>',
        'You can paste an order list anytime, or send /help.',
      ].join('\n'),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Link failed.'
    await reply(chatId, escapeTelegramHtml(message))
  }
}

async function handlePasteCheck(
  chatId: number,
  telegramUserId: number,
  pasteText: string,
): Promise<void> {
  const trimmed = pasteText.trim()
  if (!trimmed) {
    await reply(chatId, 'Paste an order list first.')
    return
  }
  if (trimmed.length > TELEGRAM_SESSION_MAX_PASTE_CHARS) {
    await reply(chatId, `List too long (max ${TELEGRAM_SESSION_MAX_PASTE_CHARS} characters).`)
    return
  }

  try {
    const result = await runTelegramPasteCheck(telegramUserId, trimmed)
    const link = await getTelegramLinkByTelegramUserId(telegramUserId)
    if (!link) throw new Error('Not linked.')

    const session: TelegramSessionJson = {
      pasteText: trimmed,
      lastCheckAt: new Date().toISOString(),
      summary: result.summary,
      idempotencyKey: link.session_json?.idempotencyKey || `tg-${telegramUserId}-${randomUUID()}`,
    }
    await updateTelegramSession(link.id, session)

    await reply(chatId, formatTelegramCheckReply(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check failed.'
    await reply(chatId, escapeTelegramHtml(message))
  }
}

async function handleConfirm(chatId: number, telegramUserId: number): Promise<void> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link?.session_json?.pasteText) {
    await reply(chatId, 'No draft to confirm. Paste an order list first.')
    return
  }

  const { pasteText, idempotencyKey } = link.session_json

  try {
    const result = await runTelegramConfirmOrder(telegramUserId, pasteText, idempotencyKey)
    await updateTelegramSession(link.id, {
      lastOrderId: result.orderId,
      lastOrderNo: result.orderNo,
    })
    await reply(chatId, formatTelegramConfirmReply(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Confirm failed.'
    await reply(chatId, escapeTelegramHtml(message))
  }
}

async function handleCancel(chatId: number, telegramUserId: number): Promise<void> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link) {
    await reply(chatId, 'Not linked.')
    return
  }
  await updateTelegramSession(link.id, {})
  await reply(chatId, 'Draft cleared.')
}

async function handleStatus(chatId: number, telegramUserId: number): Promise<void> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link) {
    await reply(chatId, 'Not linked. Open Serapp → Telegram to get a link code.')
    return
  }

  const session = link.session_json || {}
  const lines = [
    '<b>Status</b>',
    'Account: linked ✓',
    session.pasteText
      ? `Draft: ${session.summary?.label || 'checked'} · ${session.pasteText.split('\n').length} lines`
      : 'Draft: none',
    session.lastOrderNo ? `Last order: ${escapeTelegramHtml(session.lastOrderNo)}` : null,
  ].filter(Boolean)

  await reply(chatId, lines.join('\n'))
}

export async function handleTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id
  const from = message.from
  const telegramUserId = from?.id
  const text = message.text?.trim()

  if (!telegramUserId || !text || from?.is_bot) return

  const { command, args } = parseCommand(text)
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)

  if (command === TELEGRAM_COMMANDS.START) {
    if (args) {
      await handleLink(chatId, telegramUserId, args, from)
      return
    }
    await sendHelp(chatId, Boolean(link))
    return
  }

  if (command === TELEGRAM_COMMANDS.LINK) {
    await handleLink(chatId, telegramUserId, args, from)
    return
  }

  if (command === TELEGRAM_COMMANDS.HELP) {
    await sendHelp(chatId, Boolean(link))
    return
  }

  if (!link) {
    await reply(
      chatId,
      'Link your Serapod account first.\nOpen Serapp → Telegram, then send <code>/link CODE</code> here.',
    )
    return
  }

  if (command === TELEGRAM_COMMANDS.CHECK) {
    if (!link.session_json?.pasteText) {
      await reply(chatId, 'No previous paste. Send your order list as a message.')
      return
    }
    await handlePasteCheck(chatId, telegramUserId, link.session_json.pasteText)
    return
  }

  if (command === TELEGRAM_COMMANDS.CONFIRM) {
    await handleConfirm(chatId, telegramUserId)
    return
  }

  if (command === TELEGRAM_COMMANDS.CANCEL) {
    await handleCancel(chatId, telegramUserId)
    return
  }

  if (command === TELEGRAM_COMMANDS.STATUS) {
    await handleStatus(chatId, telegramUserId)
    return
  }

  if (text.startsWith('/')) {
    await reply(chatId, 'Unknown command. Send /help.')
    return
  }

  await handlePasteCheck(chatId, telegramUserId, text)
}

export async function processTelegramUpdate(update: {
  message?: TelegramMessage
  edited_message?: TelegramMessage
}): Promise<void> {
  const message = update.message || update.edited_message
  if (!message?.text) return
  await handleTelegramMessage(message)
}
