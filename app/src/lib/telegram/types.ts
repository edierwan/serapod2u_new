import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'

export interface TelegramLinkRow {
  id: string
  user_id: string
  organization_id: string
  telegram_user_id: number
  telegram_chat_id: number
  telegram_username: string | null
  telegram_first_name: string | null
  session_json: TelegramSessionJson
  linked_at: string
  last_message_at: string | null
  is_active: boolean
}

export interface TelegramSessionJson {
  pasteText?: string
  lastCheckAt?: string
  summary?: SerappPasteCheckSummary
  idempotencyKey?: string
  lastOrderId?: string
  lastOrderNo?: string | null
  pendingDiscrepancyOrderId?: string
  pendingDiscrepancyOrderNo?: string | null
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

export interface TelegramMessage {
  message_id: number
  from?: {
    id: number
    is_bot?: boolean
    first_name?: string
    username?: string
  }
  chat: {
    id: number
    type: string
  }
  date: number
  text?: string
  caption?: string
  photo?: Array<{
    file_id: string
    file_unique_id: string
    file_size?: number
    width?: number
    height?: number
  }>
}

export interface TelegramLinkTokenRow {
  id: string
  user_id: string
  token: string
  expires_at: string
  consumed_at: string | null
  created_at: string
}
