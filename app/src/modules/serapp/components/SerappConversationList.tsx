'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCirclePlus, Bot, Warehouse, Megaphone, Headphones } from 'lucide-react'
import type { SerappConversationRow } from '@/lib/serapp/conversation-types'
import { cn } from '@/lib/utils'

function formatListTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function Avatar({ avatarKey }: { avatarKey: string }) {
  const Icon =
    avatarKey === 'warehouse'
      ? Warehouse
      : avatarKey === 'news'
        ? Megaphone
        : avatarKey === 'support'
          ? Headphones
          : Bot
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--sera-ink)] text-white">
      <Icon className="h-5 w-5" />
    </div>
  )
}

export default function SerappConversationList() {
  const router = useRouter()
  const [conversations, setConversations] = useState<SerappConversationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/serapp/conversations')
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load chats.')
      }
      setConversations(payload.conversations || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createChat = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/serapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'assistant' }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Could not create chat.')
      router.push(`/serapp/conversation/${payload.conversation.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create chat.')
      setCreating(false)
    }
  }

  return (
    <div className="serapp-wa flex h-full min-h-0 flex-col bg-[var(--sera-surface)]">
      <div className="serapp-wa-header flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-base font-semibold text-white">Chats</p>
          <p className="text-[11px] text-white/70">WhatsApp-style · each thread is separate</p>
        </div>
        <button
          type="button"
          disabled={creating || loading}
          onClick={() => void createChat()}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCirclePlus className="h-3.5 w-3.5" />}
          New chat
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-xl border border-[var(--sera-danger)]/20 bg-[var(--sera-danger-soft)] px-3 py-2 text-xs text-[var(--sera-danger)]">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--sera-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chats…
          </div>
        )}

        {!loading && conversations.length === 0 && !error && (
          <div className="px-6 py-16 text-center text-sm text-[var(--sera-muted)]">
            No chats yet. Tap <strong>New chat</strong> to start.
          </div>
        )}

        <ul className="divide-y divide-[var(--sera-line)]">
          {conversations.map((chat) => (
            <li key={chat.id}>
              <Link
                href={`/serapp/conversation/${chat.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--sera-paper)]"
              >
                <Avatar avatarKey={chat.avatar_key} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--sera-ink)]">
                      {chat.title}
                    </p>
                    <span className="shrink-0 text-[10px] text-[var(--sera-muted)]">
                      {formatListTime(chat.last_message_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-[var(--sera-muted)]">
                      {chat.last_message_preview || chat.subtitle || '—'}
                    </p>
                    {chat.unread_count > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sera-orange)] px-1.5 text-[10px] font-bold text-white">
                        {chat.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className={cn('px-4 py-2 text-center text-[10px] text-[var(--sera-muted)]')}>
        Assistant · Warehouse · News are different conversations with separate history
      </p>
    </div>
  )
}
