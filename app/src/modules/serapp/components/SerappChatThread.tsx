'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Send,
  Trash2,
  Check,
  CheckCheck,
} from 'lucide-react'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import { cleanSerappLineLabel, describeSerappLineAvailability } from '@/lib/orders/paste-result-display'
import { isSerappReviewLine } from '@/lib/serapp/line-resolutions'
import type {
  SerappChatCheckPayload,
  SerappChatConfirmPayload,
  SerappDoStoryItem,
  SerappChatQuickReply,
  SerappChatSessionState,
} from '@/lib/serapp/chat-types'
import type { SerappAttachment, SerappConversationRow, SerappMessageRow } from '@/lib/serapp/conversation-types'
import { createClient } from '@/lib/supabase/client'
import { isMineSerappMessage } from '@/lib/serapp/conversation-access'
import { useSerapp } from './SerappContext'
import SerappReviewLinePicker from './SerappReviewLinePicker'
import SerappConversationAvatar from './SerappConversationAvatar'
import { SerappHqDistributorPicker, useSerappHqDistributors } from './SerappHqDistributorPicker'
import { cn } from '@/lib/utils'

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

function formatDayLabel(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startToday - startThat) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function dayKey(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function renderInlineMessage(text: string) {
  const nodes: React.ReactNode[] = []
  // Links first, then bold/italic — e.g. [History](/serapp/history)
  const token = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const raw = match[0]
    const linkMatch = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const label = linkMatch[1]
      const href = linkMatch[2]
      const isInternal = href.startsWith('/')
      nodes.push(
        isInternal ? (
          <Link
            key={`l-${match.index}`}
            href={href}
            className="font-semibold text-[var(--sera-orange)] underline underline-offset-2"
          >
            {label}
          </Link>
        ) : (
          <a
            key={`l-${match.index}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--sera-orange)] underline underline-offset-2"
          >
            {label}
          </a>
        ),
      )
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      nodes.push(<strong key={`b-${match.index}`}>{raw.slice(2, -2)}</strong>)
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      nodes.push(<em key={`i-${match.index}`}>{raw.slice(1, -1)}</em>)
    } else {
      nodes.push(raw)
    }
    cursor = token.lastIndex
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function renderMessageBody(text: string) {
  const lines = text.split('\n')
  return (
    <p className="break-words">
      {lines.map((line, index) => (
        <span key={`${index}-${line}`}>
          {renderInlineMessage(line)}
          {index < lines.length - 1 && <br />}
        </span>
      ))}
    </p>
  )
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
    senderUserId: msg.sender_user_id || null,
    senderDisplayName: msg.sender_display_name || null,
    senderKind: msg.sender_kind || null,
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
  const searchParams = useSearchParams()
  const conversationId = String(params?.id || '')
  const { isHqSupport, userProfile } = useSerapp()
  const hq = useSerappHqDistributors()

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
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [resolvingLine, setResolvingLine] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef(createClient())
  const draftAppliedRef = useRef(false)

  const load = useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/serapp/conversations/${conversationId}`)
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const why = payload?.detail
          ? payload.detail.rowFound === false
            ? 'missing'
            : payload.detail.rowFound
              ? 'denied'
              : 'unknown'
          : `http-${res.status}`
        throw new Error(`${payload?.error || 'Failed to load chat.'} (${why})`)
      }
      setConversation(payload.conversation)
      setSession(payload.session)
      setMessages((payload.messages || []).map(mapRow))
      if (payload.presence) setPresence(payload.presence)
      const linkedDistributor =
        payload.session?.distributorId
        || payload.conversation?.distributor_org_id
        || ''
      if (linkedDistributor) hq.selectDistributor(linkedDistributor)
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
    draftAppliedRef.current = false
  }, [conversationId])

  // Prefill composer from Order tab: /serapp/conversation/[id]?draft=CV%20-%2050
  useEffect(() => {
    if (!conversationId || loading || draftAppliedRef.current) return
    const draftParam = searchParams.get('draft')
    if (!draftParam) return
    draftAppliedRef.current = true
    setDraft(draftParam)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`
      const len = draftParam.length
      el.setSelectionRange(len, len)
    })
    router.replace(`/serapp/conversation/${conversationId}`, { scroll: false })
  }, [conversationId, loading, searchParams, router])

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

    if (isHqSupport && conversation?.kind === 'assistant' && !hq.selectedId) {
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
      senderUserId: userProfile.id,
      senderDisplayName: userProfile.full_name || userProfile.email || 'You',
      senderKind: isHqSupport ? 'hq' as const : 'distributor' as const,
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
          distributorId: hq.selectedId || conversation?.distributor_org_id || undefined,
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
      setDraft(text)
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

  const canDelete =
    conversation?.kind !== 'warehouse' && conversation?.kind !== 'news'

  const applyChatLinePick = async (line: number, variantId: string) => {
    if (!conversationId || resolvingLine) return
    setResolvingLine(true)
    setError(null)
    try {
      const res = await fetch(`/api/serapp/conversations/${conversationId}/resolve-line`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line,
          variantId,
          distributorId: hq.selectedId || conversation?.distributor_org_id || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Could not map that product.')
      if (payload?.session) setSession(payload.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not map that product.')
    } finally {
      setResolvingLine(false)
    }
  }

  const confirmDelete = async () => {
    if (!conversationId || !canDelete) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/serapp/conversations/${conversationId}`, {
        method: 'DELETE',
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Could not delete chat.')
      router.push('/serapp/conversation')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete chat.')
      setPendingDelete(false)
      setDeleting(false)
    }
  }

  const latestQuickReplies = (() => {
    const replies =
      [...messages].reverse().find((m) => m.role === 'bot' && m.quickReplies?.length)?.quickReplies ||
      []
    // HQ joins the distributor group chat for support — hide ordering chips
    // (Sample list, Confirm, Cancel hold, etc.) that belong to the distributor.
    if (isHqSupport) return []
    return replies
  })()

  const applyQuickReply = (qr: { id: string; sendText: string }) => {
    // Sample list: bot shows a clear example (do not send / fill composer).
    if (qr.id === 'sample') {
      const sampleBody = [
        '📋 **Sample order list**',
        '',
        'Send **one line per product**: code + qty',
        '',
        qr.sendText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `• **${line}**`)
          .join('\n'),
        '',
        'Type your own list the same way, then tap Send.',
      ].join('\n')
      setMessages((prev) => [
        ...prev,
        {
          id: `local-sample-${Date.now()}`,
          role: 'bot' as const,
          text: sampleBody,
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          seenAt: null,
          seenByOwner: true,
          senderUserId: null,
          senderDisplayName: null,
          senderKind: null,
          attachment: undefined,
          quickReplies: [
            { id: 'help', label: 'Help', sendText: 'help' },
            { id: 'sample', label: 'Sample list', sendText: qr.sendText },
          ],
          card: null,
        },
      ])
      return
    }
    void sendText(qr.sendText)
  }

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
      <div
        className="serapp-wa-header flex items-center gap-1 px-1 py-2"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <button
          type="button"
          onClick={() => router.push('/serapp/conversation')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <SerappConversationAvatar
          avatarKey={conversation.avatar_key}
          size="sm"
          onDark
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{conversation.title}</p>
          <p className="truncate text-[11px] text-white/75">
            {presenceLabel}
          </p>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={() => setPendingDelete(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
            aria-label="Delete conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {isHqSupport && conversation.kind === 'assistant' && (
        <SerappHqDistributorPicker
          selectedId={hq.selectedId}
          distributors={hq.distributors}
          loading={hq.loading}
          disabled={sending}
          onChange={(id) => {
            hq.selectDistributor(id)
            void fetch(`/api/serapp/conversations/${conversationId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ distributorId: id || null }),
            })
          }}
        />
      )}

      {error && (
        <div className="mx-3 mt-2 rounded-lg bg-[var(--sera-danger-soft)] px-3 py-2 text-xs text-[var(--sera-danger)]">
          {error}
        </div>
      )}

      <div ref={listRef} className="serapp-wa-thread min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {messages.map((msg, index) => {
          const prev = messages[index - 1]
          const showDay = !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt)
          return (
          <div key={msg.id}>
            {showDay && (
              <div className="mb-2 mt-1 flex justify-center">
                <span className="serapp-wa-date">{formatDayLabel(msg.createdAt)}</span>
              </div>
            )}
          <div
            className={cn(
              'serapp-wa-row flex',
              isMineSerappMessage({
                role: msg.role,
                senderUserId: msg.senderUserId,
                viewerUserId: userProfile.id,
                viewerIsHq: isHqSupport,
              }) ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              className={cn(
                'serapp-wa-bubble max-w-[85%] px-2 pt-1.5 pb-1 text-[14.2px] leading-[19px]',
                isMineSerappMessage({
                  role: msg.role,
                  senderUserId: msg.senderUserId,
                  viewerUserId: userProfile.id,
                  viewerIsHq: isHqSupport,
                }) ? 'serapp-wa-bubble--out' : 'serapp-wa-bubble--in',
              )}
            >
              {msg.role === 'user' && !isMineSerappMessage({
                role: msg.role,
                senderUserId: msg.senderUserId,
                viewerUserId: userProfile.id,
                viewerIsHq: isHqSupport,
              }) && (
                <p className="mb-0.5 text-[11px] font-semibold text-[var(--sera-orange)]">
                  {msg.senderKind === 'hq'
                    ? `HQ · ${msg.senderDisplayName || 'Support'}`
                    : (msg.senderDisplayName || 'Distributor')}
                </p>
              )}
              {renderMessageBody(msg.text)}
              {msg.attachment && (
                <AttachmentBubble
                  attachment={msg.attachment}
                  mine={isMineSerappMessage({
                    role: msg.role,
                    senderUserId: msg.senderUserId,
                    viewerUserId: userProfile.id,
                    viewerIsHq: isHqSupport,
                  })}
                />
              )}

              {msg.card?.kind === 'check_summary' && msg.card.check && (
                <CheckSummaryCard
                  check={
                    session?.lastCheck?.pasteText === msg.card.check.pasteText
                      ? session.lastCheck
                      : msg.card.check
                  }
                  interactive={session?.lastCheck?.pasteText === msg.card.check.pasteText}
                  disabled={sending || resolvingLine}
                  onPick={applyChatLinePick}
                />
              )}
              {msg.card?.kind === 'order_confirmed' && msg.card.confirm && (
                <ConfirmCard confirm={msg.card.confirm} />
              )}
              {msg.card?.kind === 'do_stories' && Array.isArray(msg.card.doStories) && (
                <DoStoriesCard stories={msg.card.doStories as SerappDoStoryItem[]} />
              )}

              <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none text-[#667781]">
                {formatClock(msg.createdAt)}
                {msg.role === 'user' && (
                  <span className="inline-flex">
                    {sending && msg.id.startsWith('temp-') ? (
                      <Check className="h-3.5 w-3.5 text-[#667781]" />
                    ) : msg.seenAt ? (
                      <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />
                    ) : msg.deliveredAt ? (
                      <CheckCheck className="h-3.5 w-3.5 text-[#667781]" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-[#667781]" />
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>
          </div>
          )
        })}

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
              onClick={() => applyQuickReply(qr)}
              className="serapp-wa-chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {qr.label}
            </button>
          ))}
        </div>
      )}

      <div
        className="serapp-wa-composer flex items-end gap-1.5 px-2 py-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
      >
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
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#54656f] disabled:opacity-40"
          aria-label="Attach file"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={sending}
          rows={1}
          placeholder="Message"
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`
          }}
          onKeyDown={onKeyDown}
          className="max-h-[140px] min-h-[42px] flex-1 resize-none rounded-[21px] border-0 bg-white px-4 py-2.5 text-[15px] outline-none"
        />
        <button
          type="button"
          disabled={sending || uploading || (!draft.trim() && !pendingAttachment)}
          onClick={() => void sendText(draft)}
          className="serapp-wa-send inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
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

      {pendingDelete && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 px-4 pb-8 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="serapp-thread-delete-title"
            className="w-full max-w-sm rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] p-4 shadow-xl"
          >
            <p id="serapp-thread-delete-title" className="font-display text-base font-semibold text-[var(--sera-ink)]">
              Delete conversation?
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--sera-muted)]">
              “{conversation.title}” will be removed from your chat list. This cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(false)}
                className="flex-1 rounded-xl border border-[var(--sera-line)] px-3 py-2.5 text-sm font-semibold text-[var(--sera-ink)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="flex-1 rounded-xl bg-[var(--sera-danger)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
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

function CheckSummaryCard({
  check,
  interactive,
  disabled,
  onPick,
}: {
  check: SerappChatCheckPayload
  interactive?: boolean
  disabled?: boolean
  onPick?: (line: number, variantId: string) => void
}) {
  const productLines = check.results.filter((r) => r.status !== 'section_header')
  const visible = productLines.slice(0, 12)
  const pickableLines = visible.filter(
    (line) => isSerappReviewLine(line.status) && !line.selectedVariantId && line.candidates && line.candidates.length > 0,
  )
  const warehouse = check.warehouseName || 'Warehouse'
  const nextStep =
    check.summary.bucket === 'available'
      ? 'Reply confirm to place this order.'
      : check.summary.bucket === 'partially_available'
        ? 'Reply confirm to order available qty only.'
        : check.summary.bucket === 'out_of_stock'
          ? 'Paste a new list with other products.'
          : pickableLines.length > 0
            ? 'I couldn\'t match some items — tap what you meant below, or send the correct code.'
            : 'Some items didn\'t match. Send the correct code, or paste a new list.'

  const okLines = visible.filter((line) => {
    if (!line.selectedVariantId) return false
    const status = lineStatusShort(line)
    return status !== 'Out of stock' && status !== 'Not found'
  })
  const problemLines = visible.filter((line) => !okLines.includes(line))

  return (
    <div className="serapp-wa-card mt-2 rounded-xl px-2.5 py-2">
      <div className="space-y-2 text-[12px] text-[var(--sera-ink)]">
        {okLines.length > 0 && (
          <div>
            <p className="text-sm font-bold text-[var(--sera-ink)] underline">Matched</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--sera-ink-soft)]">
              {okLines.map((line, idx) => (
                <li key={`ok-${line.line}-${idx}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{cleanSerappLineLabel(line.name || line.raw)}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--sera-ink)]">
                    {lineStatusShort(line)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {problemLines.length > 0 && (
          <div>
            <p className="text-sm font-bold text-[var(--sera-ink)] underline">Couldn&apos;t match</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--sera-ink-soft)]">
              {problemLines.map((line, idx) => (
                <li key={`unclear-${line.line}-${idx}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{cleanSerappLineLabel(line.name || line.raw)}</span>
                  <span className="shrink-0 font-semibold text-[var(--sera-orange-deep)]">
                    {lineStatusShort(line)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p>
          <span className="font-semibold text-[var(--sera-muted)]">Warehouse: </span>
          {warehouse}
        </p>
        <p>
          <span className="font-semibold text-[var(--sera-muted)]">Est. price: </span>
          {formatMoney(check.estimatedOrderValue)}
        </p>
        <p className="rounded-lg bg-[var(--sera-orange)]/10 px-2 py-1.5 text-[11px] font-semibold text-[var(--sera-orange-deep)]">
          Next step: {nextStep}
        </p>
      </div>
      {interactive && onPick && pickableLines.length > 0 && (
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto border-t border-[var(--sera-line)]/50 pt-2">
          <p className="text-[11px] font-semibold text-[var(--sera-ink)]">
            Did you mean one of these?
          </p>
          {pickableLines.map((line) => (
            <SerappReviewLinePicker
              key={`picker-${line.line}-${line.raw}`}
              result={line}
              disabled={disabled}
              onPick={onPick}
            />
          ))}
        </div>
      )}
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
  return describeSerappLineAvailability(result)
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
