'use client'

import { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageCircle, X } from 'lucide-react'
import type { SerappConversationRow } from '@/lib/serapp/conversation-types'
import { createClient } from '@/lib/supabase/client'
import { useSerapp } from './SerappContext'

/**
 * Keeps Chat tab unread badge in sync and shows an in-app toast when a new
 * inbound message arrives while the user is elsewhere in Serapp.
 * Uses browser Notification only if permission was already granted.
 */
export default function SerappMessageNotifier() {
  const pathname = usePathname()
  const {
    setTotalUnread,
    messageToast,
    showMessageToast,
    dismissMessageToast,
  } = useSerapp()
  const supabaseRef = useRef(createClient())
  const prevByIdRef = useRef<Map<string, { unread: number; preview: string | null; title: string }>>(
    new Map(),
  )
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bootstrappedRef = useRef(false)

  const refresh = useCallback(async (opts?: { announce?: boolean }) => {
    try {
      const res = await fetch('/api/serapp/conversations')
      const payload = await res.json().catch(() => null)
      if (!res.ok) return

      const conversations = (payload?.conversations || []) as SerappConversationRow[]
      const total = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)
      setTotalUnread(total)

      const nextMap = new Map<string, { unread: number; preview: string | null; title: string }>()
      for (const chat of conversations) {
        nextMap.set(chat.id, {
          unread: chat.unread_count || 0,
          preview: chat.last_message_preview,
          title: chat.title,
        })
      }

      if (opts?.announce && bootstrappedRef.current) {
        const viewingThread =
          pathname?.startsWith('/serapp/conversation/') &&
          pathname.split('/').pop()

        for (const [id, next] of nextMap) {
          const prev = prevByIdRef.current.get(id)
          if (!prev) continue
          if (next.unread <= prev.unread) continue
          if (viewingThread === id) continue

          showMessageToast({
            title: next.title,
            preview: next.preview || 'New message',
            conversationId: id,
          })

          if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              try {
                new Notification(next.title, {
                  body: next.preview || 'New message',
                  tag: `serapp-${id}`,
                })
              } catch {
                /* ignore */
              }
            }
          }
          break
        }
      }

      prevByIdRef.current = nextMap
      bootstrappedRef.current = true
    } catch {
      /* ignore network blips */
    }
  }, [pathname, setTotalUnread, showMessageToast])

  useEffect(() => {
    void refresh({ announce: false })
  }, [refresh])

  useEffect(() => {
    const supabase = supabaseRef.current
    const channel = supabase
      .channel('serapp_unread_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'serapp_conversations' },
        () => {
          void refresh({ announce: true })
        },
      )
      .subscribe()

    const poll = setInterval(() => {
      void refresh({ announce: true })
    }, 45000)

    return () => {
      void supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [refresh])

  useEffect(() => {
    if (!messageToast) return
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => dismissMessageToast(), 5500)
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [messageToast, dismissMessageToast])

  // Keep badge accurate when opening a thread (unread clears server-side).
  useEffect(() => {
    if (pathname?.startsWith('/serapp/conversation/')) {
      void refresh({ announce: false })
    }
  }, [pathname, refresh])

  if (!messageToast) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[60] flex justify-center px-3"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2.5 shadow-lg">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sera-orange)] text-white">
          <MessageCircle className="h-4 w-4" />
        </div>
        <Link
          href={`/serapp/conversation/${messageToast.conversationId}`}
          onClick={dismissMessageToast}
          className="min-w-0 flex-1"
        >
          <p className="truncate text-sm font-semibold text-[var(--sera-ink)]">{messageToast.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--sera-muted)]">{messageToast.preview}</p>
        </Link>
        <button
          type="button"
          onClick={dismissMessageToast}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--sera-muted)] hover:bg-[var(--sera-mist)]"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
