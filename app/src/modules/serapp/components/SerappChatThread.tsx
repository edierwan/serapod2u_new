'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  Megaphone,
  Send,
  Warehouse,
} from 'lucide-react'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import type {
  SerappChatCheckPayload,
  SerappChatConfirmPayload,
  SerappChatQuickReply,
  SerappChatSessionState,
} from '@/lib/serapp/chat-types'
import type { SerappConversationRow, SerappMessageRow } from '@/lib/serapp/conversation-types'
import { createClient } from '@/lib/supabase/client'
import { useSerapp } from './SerappContext'
import { cn } from '@/lib/utils'

interface DistributorOption {
  id: string
  org_name: string
  org_code: string | null
}

const bucketTone: Record<string, string> = {
  available: 'serapp-wa-badge--ok',
  partially_available: 'serapp-wa-badge--warn',
  out_of_stock: 'serapp-wa-badge--danger',
  unmatched_or_review: 'serapp-wa-badge--muted',
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function mapRow(msg: SerappMessageRow) {
  return {
    id: msg.id,
    role: msg.role,
    text: msg.body,
    createdAt: msg.created_at,
    quickReplies: (msg.quick_replies_json || undefined) as SerappChatQuickReply[] | undefined,
    card: msg.card_json as {
      kind: string
      check?: SerappChatCheckPayload
      confirm?: SerappChatConfirmPayload
      error?: string
    } | null,
  }
}

export default function SerappChatThread() {
  const params = useParams()
  const router = useRouter()
  const conversationId = String(params?.id || '')
  const { userProfile, isHqSupport } = useSerapp()

  const [conversation, setConversation] = useState<SerappConversationRow | null>(null)
  const [messages, setMessages] = useState<ReturnType<typeof mapRow>[]>([])
  const [session, setSession] = useState<SerappChatSessionState | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [distributors, setDistributors] = useState<DistributorOption[]>([])
  const [selectedDistributorId, setSelectedDistributorId] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/serapp/conversations/${conversationId}`)
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Failed to load chat.')
      setConversation(payload.conversation)
      setSession(payload.session)
      setMessages((payload.messages || []).map(mapRow))
      if (payload.session?.distributorId) {
        setSelectedDistributorId(payload.session.distributorId)
      } else if (payload.conversation?.distributor_org_id) {
        setSelectedDistributorId(payload.conversation.distributor_org_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat.')
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isHqSupport) return
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('organizations')
          .select('id, org_name, org_code')
          .eq('parent_org_id', userProfile.organization_id)
          .eq('org_type_code', 'DIST')
          .eq('is_active', true)
          .order('org_name')
          .limit(100)
        if (!cancelled) setDistributors((data || []) as DistributorOption[])
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isHqSupport, userProfile.organization_id])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, typing])

  const sendText = async (raw: string) => {
    const text = raw.trim()
    if (!text || sending || !conversationId) return

    if (isHqSupport && conversation?.kind === 'assistant' && !selectedDistributorId) {
      setError('Select a distributor first (HQ Support).')
      return
    }

    const clientMessageId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c-${Date.now()}`

    // Optimistic user bubble
    const optimistic = {
      id: `temp-${clientMessageId}`,
      role: 'user' as const,
      text,
      createdAt: new Date().toISOString(),
      quickReplies: undefined,
      card: null,
    }
    setMessages((prev) => [...prev, optimistic])
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    setTyping(true)
    setError(null)

    try {
      const res = await fetch(`/api/serapp/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          clientMessageId,
          distributorId: selectedDistributorId || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Send failed.')

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== optimistic.id)
        return [
          ...withoutTemp,
          mapRow(payload.userMessage),
          mapRow(payload.botMessage),
        ]
      })
      setSession(payload.session)
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setError(err instanceof Error ? err.message : 'Send failed.')
    } finally {
      setTyping(false)
      setSending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendText(draft)
    }
  }

  const latestQuickReplies =
    [...messages].reverse().find((m) => m.role === 'bot' && m.quickReplies?.length)?.quickReplies ||
    []

  const HeaderIcon =
    conversation?.avatar_key === 'warehouse'
      ? Warehouse
      : conversation?.avatar_key === 'news'
        ? Megaphone
        : conversation?.avatar_key === 'support'
          ? Headphones
          : Bot

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--sera-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening chat…
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="space-y-3 px-4 py-8 text-center">
        <p className="text-sm text-[var(--sera-danger)]">{error || 'Chat not found.'}</p>
        <button
          type="button"
          onClick={() => router.push('/serapp/conversation')}
          className="text-sm font-semibold text-[var(--sera-orange)]"
        >
          Back to chats
        </button>
      </div>
    )
  }

  return (
    <div className="serapp-wa flex h-full min-h-0 flex-col">
      <div className="serapp-wa-header flex items-center gap-2 px-2 py-2.5">
        <button
          type="button"
          onClick={() => router.push('/serapp/conversation')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
          <HeaderIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{conversation.title}</p>
          <p className="truncate text-[11px] text-white/75">
            {typing ? 'typing…' : conversation.subtitle || 'online'}
          </p>
        </div>
      </div>

      {isHqSupport && conversation.kind === 'assistant' && (
        <div className="border-b border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
            Distributor (HQ Support)
          </label>
          <select
            value={selectedDistributorId}
            disabled={sending}
            onChange={(e) => {
              setSelectedDistributorId(e.target.value)
              void fetch(`/api/serapp/conversations/${conversationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ distributorId: e.target.value || null }),
              })
            }}
            className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sera-orange)]"
          >
            <option value="">Select distributor…</option>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.org_name}
                {d.org_code ? ` (${d.org_code})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mx-3 mt-2 rounded-lg bg-[var(--sera-danger-soft)] px-3 py-2 text-xs text-[var(--sera-danger)]">
          {error}
        </div>
      )}

      <div ref={listRef} className="serapp-wa-thread min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('serapp-wa-row flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'serapp-wa-bubble max-w-[88%] px-3 py-2 text-sm leading-5 shadow-sm',
                msg.role === 'user' ? 'serapp-wa-bubble--out' : 'serapp-wa-bubble--in',
              )}
            >
              <p className="whitespace-pre-wrap break-words">{msg.text.replace(/\*/g, '')}</p>

              {msg.card?.kind === 'check_summary' && msg.card.check && (
                <CheckSummaryCard check={msg.card.check} />
              )}
              {msg.card?.kind === 'order_confirmed' && msg.card.confirm && (
                <ConfirmCard confirm={msg.card.confirm} />
              )}

              <p
                className={cn(
                  'mt-1 text-right text-[10px]',
                  msg.role === 'user' ? 'text-black/45' : 'text-[var(--sera-muted)]',
                )}
              >
                {formatClock(msg.createdAt)}
                {msg.role === 'user' ? (sending && msg.id.startsWith('temp-') ? ' ✓' : ' ✓✓') : ''}
              </p>
            </div>
          </div>
        ))}

        {typing && (
          <div className="serapp-wa-row flex justify-start">
            <div className="serapp-wa-bubble serapp-wa-bubble--in flex items-center gap-1 px-3 py-2.5">
              <span className="serapp-wa-dot" />
              <span className="serapp-wa-dot" />
              <span className="serapp-wa-dot" />
            </div>
          </div>
        )}
      </div>

      {latestQuickReplies.length > 0 && !sending && (
        <div className="flex gap-2 overflow-x-auto border-t border-[var(--sera-line)]/60 bg-[var(--sera-surface)]/90 px-3 py-2">
          {latestQuickReplies.map((qr) => (
            <button
              key={qr.id}
              type="button"
              disabled={sending}
              onClick={() => void sendText(qr.sendText)}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {qr.label}
            </button>
          ))}
        </div>
      )}

      <div className="serapp-wa-composer flex items-end gap-2 border-t border-[var(--sera-line)] px-2 py-2">
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={sending}
          rows={1}
          placeholder="Type a message…"
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`
          }}
          onKeyDown={onKeyDown}
          className="max-h-[140px] min-h-[42px] flex-1 resize-none rounded-2xl border border-[var(--sera-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--sera-orange)]"
        />
        <button
          type="button"
          disabled={sending || !draft.trim()}
          onClick={() => void sendText(draft)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sera-orange)] text-white disabled:opacity-40"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

function CheckSummaryCard({ check }: { check: SerappChatCheckPayload }) {
  const productLines = check.results.filter((r) => r.status !== 'section_header').slice(0, 8)
  return (
    <div className="serapp-wa-card mt-2 rounded-xl px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('serapp-wa-badge', bucketTone[check.summary.bucket])}>
          {check.summary.label}
        </span>
        <span className="text-[11px] text-[var(--sera-muted)]">
          Est. {formatMoney(check.estimatedOrderValue)}
        </span>
      </div>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-[var(--sera-ink-soft)]">
        {productLines.map((line, idx) => (
          <li
            key={`${line.raw}-${idx}`}
            className="flex justify-between gap-2 border-b border-[var(--sera-line)]/50 py-1 last:border-0"
          >
            <span className="min-w-0 truncate">{line.name || line.raw}</span>
            <span className="shrink-0 tabular-nums text-[var(--sera-muted)]">
              {line.quantity ?? '—'} · {lineStatusShort(line)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConfirmCard({ confirm }: { confirm: SerappChatConfirmPayload }) {
  return (
    <div className="serapp-wa-card mt-2 rounded-xl px-2.5 py-2">
      <div className="flex items-center gap-2 text-[var(--sera-success)]">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm font-semibold">{confirm.orderNo}</span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--sera-muted)]">
        {confirm.confirmedLines} lines
        {confirm.skippedLines ? ` · ${confirm.skippedLines} skipped` : ''}
        {' · '}
        {formatMoney(confirm.estimatedOrderValue)}
      </p>
      <Link
        href="/serapp/history"
        className="mt-2 inline-flex text-[11px] font-semibold text-[var(--sera-orange)]"
      >
        Open History →
      </Link>
    </div>
  )
}

function lineStatusShort(result: PasteMatchResult): string {
  if (
    result.status === 'requires_review' ||
    result.status === 'not_found' ||
    result.status === 'ambiguous'
  ) {
    return 'Review'
  }
  if (result.inventoryOutcome === 'insufficient_stock') return 'Partial'
  if (result.inventoryOutcome === 'no_available_stock') return 'OOS'
  if (result.status === 'matched' || result.status === 'alternative_match') return 'OK'
  return result.status
}
