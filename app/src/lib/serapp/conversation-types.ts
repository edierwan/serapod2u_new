import type { SerappChatQuickReply, SerappChatSessionState } from '@/lib/serapp/chat-types'
import { parseSerappLineResolutions } from '@/lib/serapp/line-resolutions'

export type SerappConversationKind = 'assistant' | 'warehouse' | 'news' | 'support'

export interface SerappConversationRow {
  id: string
  owner_user_id: string
  owner_org_id: string
  distributor_org_id: string | null
  kind: SerappConversationKind
  title: string
  subtitle: string | null
  avatar_key: string
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
  session_json: SerappChatSessionState | Record<string, unknown>
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface SerappMessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'bot' | 'system'
  body: string
  card_json: SerappChatMessageCard | null
  quick_replies_json: SerappChatQuickReply[] | null
  client_message_id: string | null
  attachment_json: SerappAttachment | null
  delivered_at: string | null
  seen_at: string | null
  seen_by_owner: boolean
  sender_user_id?: string | null
  sender_display_name?: string | null
  sender_kind?: 'distributor' | 'hq' | null
  created_at: string
}

export interface SerappAttachment {
  bucket: string
  path: string
  name: string
  size: number
  mimeType: string
  url?: string | null
}

export interface SerappChatMessageCard {
  kind: 'check_summary' | 'order_confirmed' | 'do_stories' | 'error'
  check?: unknown
  confirm?: unknown
  doStories?: unknown
  error?: string
}

export const DEFAULT_SESSION: SerappChatSessionState = {
  phase: 'awaiting_list',
  pendingPasteText: null,
  lastCheck: null,
  lastConfirm: null,
  distributorId: null,
  lineResolutions: [],
}

export function parseSession(raw: unknown): SerappChatSessionState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SESSION }
  const s = raw as Partial<SerappChatSessionState>
  return {
    phase: s.phase || 'awaiting_list',
    pendingPasteText: s.pendingPasteText ?? null,
    lastCheck: s.lastCheck ?? null,
    lastConfirm: s.lastConfirm ?? null,
    distributorId: s.distributorId ?? null,
    lineResolutions: parseSerappLineResolutions(s.lineResolutions),
  }
}

export const SEED_CHATS: Array<{
  kind: SerappConversationKind
  title: string
  subtitle: string
  avatar_key: string
  welcome: string
}> = [
  {
    kind: 'assistant',
    title: 'Serapp Assistant',
    subtitle: 'Order · stock check · confirm',
    avatar_key: 'bot',
    welcome:
      "Hi — I'm *Serapp Assistant*.\n\nPaste a list like *CV - 50* or *GU - 100*. I'll check warehouse stock, then you can confirm.\n\nEach chat is separate — open Warehouse Desk or News for other topics.",
  },
  {
    kind: 'warehouse',
    title: 'Warehouse Desk',
    subtitle: 'Acceptance holds · DO status',
    avatar_key: 'warehouse',
    welcome:
      "Warehouse Desk here.\n\nAsk about your *active holds*, warehouse acceptance window, or Delivery Order (DO) status.\n\nTip: place orders in *Serapp Assistant*, then track acceptance here or in History.",
  },
  {
    kind: 'news',
    title: 'Serapod News',
    subtitle: 'Announcements',
    avatar_key: 'news',
    welcome:
      "Serapod News.\n\nThis thread will carry HQ announcements for distributors.\n\nSay *latest* for a sample update, or open the News tab anytime.",
  },
]

export function previewFromBody(body: string, max = 72): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}
