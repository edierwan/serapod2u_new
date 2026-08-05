'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileText,
  Headphones,
  ImageIcon,
  Loader2,
  Megaphone,
  Paperclip,
  Send,
  Warehouse,
  Check,
  CheckCheck,
} from 'lucide-react'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import type {
  SerappChatCheckPayload,
  SerappChatConfirmPayload,
  SerappDoStoryItem,
  SerappChatQuickReply,
  SerappChatSessionState,
} from '@/lib/serapp/chat-types'
import type { SerappAttachment, SerappConversationRow, SerappMessageRow } from '@/lib/serapp/conversation-types'
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
    deliveredAt: msg.delivered_at,
    seenAt: msg.seen_at,
    seenByOwner: msg.seen_by_owner,
    attachment: msg.attachment_json,
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
  const [uploading, setUploading] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<SerappAttachment | null>(null)
  const [presence, setPresence] = useState<{ is_online: boolean; last_seen_at: string | null }>({
    is_online: true,
    last_seen_at: null,
  })
  const [distributors, setDistributors] = useState<DistributorOption[]>([])
  const [selectedDistributorId, setSelectedDistributorId] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef(createClient())

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
      if (payload.presence) setPresence(payload.presence)
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

  useEffect(() => {
    if (!conversationId) return
    const supabase = supabaseRef.current
    const channel = supabase
      .channel(`serapp_thread_${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'serapp_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as SerappMessageRow
          const next = mapRow(row)
          setMessages((prev) => {
            if (prev.some((m) => m.id === next.id)) return prev
            return [...prev, next]
          })
          if (row.role === 'bot' || row.role === 'system') {
            setTyping(false)
            setSending(false)
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'serapp_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as SerappMessageRow
          const next = mapRow(row)
          setMessages((prev) =>
            prev.map((m) => (m.id === next.id ? { ...m, ...next } : m)),
          )
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'serapp_conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as SerappConversationRow
          setConversation((prev) => (prev ? { ...prev, ...row } : (row as SerappConversationRow)))
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    let stopped = false
    const beat = async (isOnline = true) => {
      try {
        const res = await fetch('/api/serapp/presence', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isOnline, conversationId }),
        })
        const payload = await res.json().catch(() => null)
        if (!stopped && payload?.presence) setPresence(payload.presence)
      } catch {
        // ignore heartbeat failures
      }
    }
    void beat(true)
    const timer = setInterval(() => {
      void beat(true)
    }, 20000)

    const onVis = () => {
      void beat(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      void beat(false)
    }
  }, [conversationId])

  const sendText = async (raw: string) => {
    const text = raw.trim()
    if ((!text && !pendingAttachment) || sending || !conversationId) return

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
      text: text || (pendingAttachment ? `📎 ${pendingAttachment.name}` : ''),
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      seenAt: null,
      seenByOwner: false,
      attachment: pendingAttachment,
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
          attachment: pendingAttachment,
          distributorId: selectedDistributorId || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Send failed.')

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== optimistic.id)
        const incoming = [payload.userMessage, payload.botMessage].filter(Boolean).map(mapRow)
        const map = new Map(withoutTemp.map((m) => [m.id, m]))
        for (const msg of incoming) map.set(msg.id, msg)
        return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      })
      setSession(payload.session)
      setPendingAttachment(null)
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setError(err instanceof Error ? err.message : 'Send failed.')
    } finally {
      setTyping(false)
      setSending(false)
    }
  }

  const handlePickAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !conversationId) return
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/serapp/conversations/${conversationId}/attachments`, {
        method: 'POST',
        body: form,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload?.attachment) {
        throw new Error(payload?.error || 'Attachment upload failed.')
      }
      setPendingAttachment(payload.attachment as SerappAttachment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attachment upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
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

  const presenceLabel = typing
    ? 'typing…'
    : presence.is_online
      ? 'online'
      : presence.last_seen_at
        ? `last seen ${formatClock(presence.last_seen_at)}`
        : (conversation?.subtitle || 'offline')

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
            {presenceLabel}
          </p>
        </div>
      </div>

      {conversation.kind === 'warehouse' && (
        <div className="border-b border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
            Quick actions
          </p>
          <div className="mt-1.5 flex gap-2 overflow-x-auto">
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('my holds')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              My holds
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('pending accept')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Pending accept
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('do status')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Latest DO
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('help')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Help
            </button>
          </div>
        </div>
      )}

      {conversation.kind === 'assistant' && (
        <div className="border-b border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
            Quick actions
          </p>
          <div className="mt-1.5 flex gap-2 overflow-x-auto">
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('HERO\nBANANA VANILLA - 100\nGUAVA - 200\n\nZERO\nALMOND - 100\nTEA - 200')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Paste sample
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('check again')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Check again
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('confirm')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('new order')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              New order
            </button>
            <button
              type="button"
              disabled={sending || uploading}
              onClick={() => void sendText('help')}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              Help
            </button>
          </div>
        </div>
      )}

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
              {msg.attachment && (
                <AttachmentBubble attachment={msg.attachment} mine={msg.role === 'user'} />
              )}

              {msg.card?.kind === 'check_summary' && msg.card.check && (
                <CheckSummaryCard check={msg.card.check} />
              )}
              {msg.card?.kind === 'order_confirmed' && msg.card.confirm && (
                <ConfirmCard confirm={msg.card.confirm} />
              )}
              {msg.card?.kind === 'do_stories' && Array.isArray(msg.card.doStories) && (
                <DoStoriesCard stories={msg.card.doStories as SerappDoStoryItem[]} />
              )}

              <p
                className={cn(
                  'mt-1 text-right text-[10px]',
                  msg.role === 'user' ? 'text-black/45' : 'text-[var(--sera-muted)]',
                )}
              >
                {formatClock(msg.createdAt)}
                {msg.role === 'user' && (
                  <span className="ml-1 inline-flex align-middle">
                    {sending && msg.id.startsWith('temp-') ? (
                      <Check className="h-3 w-3 text-black/45" />
                    ) : msg.seenAt ? (
                      <CheckCheck className="h-3 w-3 text-sky-500" />
                    ) : msg.deliveredAt ? (
                      <CheckCheck className="h-3 w-3 text-black/45" />
                    ) : (
                      <Check className="h-3 w-3 text-black/45" />
                    )}
                  </span>
                )}
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handlePickAttachment}
          className="hidden"
        />
        <button
          type="button"
          disabled={sending || uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--sera-line)] bg-white text-[var(--sera-ink-soft)] disabled:opacity-40"
          aria-label="Attach file"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </button>
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
          disabled={sending || uploading || (!draft.trim() && !pendingAttachment)}
          onClick={() => void sendText(draft)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sera-orange)] text-white disabled:opacity-40"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {pendingAttachment && (
        <div className="border-t border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2 text-xs text-[var(--sera-ink-soft)]">
          Pending attachment: <span className="font-semibold">{pendingAttachment.name}</span>
          <button
            type="button"
            onClick={() => setPendingAttachment(null)}
            className="ml-2 text-[var(--sera-orange)]"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

function AttachmentBubble({ attachment, mine }: { attachment: SerappAttachment; mine: boolean }) {
  const isImage = attachment.mimeType.startsWith('image/')
  return (
    <div className="mt-2">
      {isImage && attachment.url ? (
        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-h-52 w-auto rounded-lg border border-black/10"
          />
        </a>
      ) : (
        <a
          href={attachment.url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs underline',
            mine ? 'text-blue-900' : 'text-[var(--sera-orange-deep)]',
          )}
        >
          {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
          {attachment.name}
        </a>
      )}
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

function DoStoriesCard({ stories }: { stories: SerappDoStoryItem[] }) {
  return (
    <div className="serapp-wa-card mt-2 rounded-xl px-2.5 py-2">
      <p className="text-[11px] font-semibold text-[var(--sera-ink-soft)]">Delivery Order stories</p>
      <ul className="mt-1 space-y-1.5 text-[11px]">
        {stories.slice(0, 4).map((item) => (
          <li key={item.orderId} className="rounded-md border border-[var(--sera-line)]/60 bg-white/60 px-2 py-1.5">
            <p className="font-semibold text-[var(--sera-ink)]">{item.orderLabel}</p>
            <p className="text-[var(--sera-muted)]">{item.story}</p>
            {item.do?.downloadUrl && (
              <a
                href={item.do.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex text-[11px] font-semibold text-[var(--sera-orange)] underline"
              >
                Open DO PDF
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
