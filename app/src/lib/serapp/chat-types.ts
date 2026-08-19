import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'

export type SerappChatRole = 'user' | 'bot' | 'system'

export type SerappChatCardKind = 'check_summary' | 'order_confirmed' | 'do_stories' | 'error'

export interface SerappChatQuickReply {
  id: string
  label: string
  /** Text sent as if the user typed it */
  sendText: string
}

export interface SerappChatCheckPayload {
  summary: SerappPasteCheckSummary
  results: PasteMatchResult[]
  estimatedOrderValue: number
  warehouseName?: string | null
  distributorName?: string | null
  pasteText: string
}

export interface SerappChatConfirmPayload {
  orderNo: string
  orderId: string
  status: string
  holdExpiresAt?: string | null
  confirmedLines: number
  skippedLines: number
  estimatedOrderValue: number
  warehouseName?: string | null
  note?: string
}

export interface SerappDoStoryItem {
  orderId: string
  orderLabel: string
  orderStatus: string
  holdStatus: string
  story: string
  do: {
    docNo?: string | null
    displayDocNo?: string | null
    status?: string | null
    downloadUrl?: string | null
  } | null
  updatedAt: string
}

export interface SerappChatMessage {
  id: string
  role: SerappChatRole
  text: string
  createdAt: string
  quickReplies?: SerappChatQuickReply[]
  card?: {
    kind: SerappChatCardKind
    check?: SerappChatCheckPayload
    confirm?: SerappChatConfirmPayload
    doStories?: SerappDoStoryItem[]
    error?: string
  }
}

export type SerappChatSessionPhase =
  | 'idle'
  | 'awaiting_list'
  | 'checked'
  | 'confirmed'
  | 'blocked'

export interface SerappChatSessionState {
  phase: SerappChatSessionPhase
  pendingPasteText: string | null
  lastCheck: SerappChatCheckPayload | null
  lastConfirm: SerappChatConfirmPayload | null
  distributorId: string | null
  lineResolutions: Array<{ line: number; variantId: string }>
}

export interface ChatTurnBotReply {
  text: string
  quickReplies?: SerappChatQuickReply[]
  card?: {
    kind: SerappChatCardKind
    check?: SerappChatCheckPayload
    confirm?: SerappChatConfirmPayload
    doStories?: SerappDoStoryItem[]
    error?: string
  }
  session: SerappChatSessionState
}
