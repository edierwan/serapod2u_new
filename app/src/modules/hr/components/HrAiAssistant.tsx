'use client'

/**
 * HR AI Assistant – Floating Button + Chat Drawer (v2)
 *
 * Production-ready assistant with:
 *   • BM/EN language-aware replies
 *   • Suggestion chips (Kodee-style)
 *   • Data cards/tables from DB tools
 *   • Status chip (Online / Offline / Connecting)
 *   • Proper autoscroll via bottom sentinel
 *   • No retry spam
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wrench,
  ExternalLink,
  MessageSquare,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { HrAuditResult, AiResponse } from '@/lib/ai/types'

// ─── API response shape from /api/hr/assistant/chat ────────────────

interface AssistantResponse {
  reply: string
  lang: 'ms' | 'en'
  mode: 'tool' | 'ai+tool' | 'ai' | 'offline'
  intent: string
  confidence: string
  suggestions: Array<{ label: string; intent: string }>
  cards: Array<{ title: string; rows: Record<string, any>[]; deepLink?: string }>
  meta?: Record<string, any>
}

// ─── Types ─────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  /** Suggestion chips from the new endpoint */
  suggestions?: AssistantResponse['suggestions']
  /** Data cards (tables) from tool results */
  cards?: AssistantResponse['cards']
  /** Response mode indicator */
  mode?: AssistantResponse['mode']
  /** Legacy: audit card */
  isAuditCard?: boolean
  auditData?: HrAuditResult
  /** Legacy: fix actions */
  suggested_actions?: AiResponse['suggested_actions']
}

type ConnectionStatus = 'online' | 'offline' | 'connecting'

// ─── Component ─────────────────────────────────────────────────────

export default function HrAiAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [lastAudit, setLastAudit] = useState<HrAuditResult | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const retryCountRef = useRef(0)

  // ── Autoscroll (bottom sentinel) ─────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ── Focus input when opening ─────────────────────────────────────
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  // ── Listen for toggle event from HRTopNav AI button ──────────────
  useEffect(() => {
    const handler = () => setOpen((prev) => !prev)
    window.addEventListener('hr-ai-assistant-toggle', handler)
    return () => window.removeEventListener('hr-ai-assistant-toggle', handler)
  }, [])

  // ── Health poll (every 60 s) → status chip ───────────────────────
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/ai/health')
        const json = await res.json()
        if (mounted) {
          if (json.ok) {
            // Any provider is authenticated/ok
            setStatus('online')
          } else if (json.providers?.ollama?.ok) {
            setStatus('online')
          } else if (json.anyProviderAvailable) {
            // Server reachable but auth failed → DB mode is fine
            setStatus('offline')
          } else {
            setStatus('offline')
          }
        }
      } catch {
        if (mounted) setStatus('offline')
      }
    }
    check()
    const iv = setInterval(check, 60_000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  // ── Run audit (legacy) ───────────────────────────────────────────

  const runAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const res = await fetch('/api/hr/ai/audit')
      const json = await res.json()
      if (json.success && json.data) {
        const audit = json.data as HrAuditResult
        setLastAudit(audit)
        setMessages((prev) => [
          ...prev,
          {
            id: `audit-${Date.now()}`,
            role: 'assistant',
            content: `HR Audit completed: ${audit.summary.configured}/${audit.summary.total} checks passed.`,
            timestamp: new Date(),
            isAuditCard: true,
            auditData: audit,
          },
        ])
      } else {
        pushError(`Failed to run audit: ${json.error ?? 'Unknown error'}`)
      }
    } catch (err: any) {
      pushError(`Audit request failed: ${err.message}`)
    } finally {
      setAuditLoading(false)
    }
  }, [])

  const pushError = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `err-${Date.now()}`, role: 'assistant', content, timestamp: new Date() },
    ])
  }

  // ── Send message (streaming SSE endpoint) ─────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setLoading(true)

      const assistantMsgId = `ai-${Date.now()}`

      try {
        // Build conversation history (last 10 messages)
        const history = messages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        const res = await fetch('/api/hr/assistant/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim(), history }),
        })

        if (!res.ok || !res.body) {
          // Fallback: try batch endpoint
          const batchRes = await fetch('/api/hr/assistant/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text.trim(), history }),
          })
          const json = await batchRes.json()
          if (json.success && json.data) {
            const data = json.data as AssistantResponse
            retryCountRef.current = 0
            setStatus(data.mode === 'offline' ? 'offline' : 'online')
            setMessages((prev) => [
              ...prev,
              {
                id: assistantMsgId,
                role: 'assistant',
                content: data.reply,
                timestamp: new Date(),
                suggestions: data.suggestions,
                cards: data.cards,
                mode: data.mode,
              },
            ])
          } else {
            pushError(json.error ?? 'Failed to get response from assistant.')
          }
          setLoading(false)
          return
        }

        // Parse SSE stream
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let streamingText = ''
        let gotFirstToken = false
        let metaData: Partial<AssistantResponse> = {}

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim()
              // Next line should be data:
              continue
            }
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6)

            try {
              // Determine event type from the preceding event: line
              // SSE format: event: <type>\ndata: <json>\n\n
              // We need to track the event type
              const parsed = JSON.parse(jsonStr)

              // Detect event type from content
              if ('t' in parsed) {
                // Token event
                streamingText += parsed.t
                if (!gotFirstToken) {
                  gotFirstToken = true
                  // Add empty assistant message that we'll update
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: assistantMsgId,
                      role: 'assistant',
                      content: streamingText,
                      timestamp: new Date(),
                      mode: metaData.mode,
                    },
                  ])
                  setLoading(false) // Stop showing "Thinking…"
                } else {
                  // Update the streaming message
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: streamingText } : m,
                    ),
                  )
                }
              } else if ('reply' in parsed && 'suggestions' in parsed) {
                // Fast-path or done event with full response
                retryCountRef.current = 0
                setStatus(parsed.mode === 'offline' ? 'offline' : 'online')
                setMessages((prev) => {
                  // Replace existing streaming msg or add new one
                  const existing = prev.find((m) => m.id === assistantMsgId)
                  if (existing) {
                    return prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            content: parsed.reply || streamingText,
                            suggestions: parsed.suggestions,
                            cards: parsed.cards,
                            mode: parsed.mode,
                          }
                        : m,
                    )
                  }
                  return [
                    ...prev,
                    {
                      id: assistantMsgId,
                      role: 'assistant' as const,
                      content: parsed.reply || streamingText,
                      timestamp: new Date(),
                      suggestions: parsed.suggestions,
                      cards: parsed.cards,
                      mode: parsed.mode,
                    },
                  ]
                })
                setLoading(false)
              } else if ('reply' in parsed && 'metrics' in parsed) {
                // Done event (streaming completed)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: parsed.reply || streamingText,
                          suggestions: metaData.suggestions,
                          cards: metaData.cards,
                          mode: metaData.mode,
                        }
                      : m,
                  ),
                )
                setLoading(false)
              } else if ('error' in parsed) {
                if (streamingText) {
                  // Partial response + error — show what we have
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: streamingText + '\n\n⚠️ ' + parsed.error }
                        : m,
                    ),
                  )
                } else {
                  pushError(parsed.error)
                }
                setLoading(false)
              } else if ('mode' in parsed && 'lang' in parsed) {
                // Meta event
                metaData = parsed
              }
            } catch {
              // Malformed JSON — skip
            }
          }
        }

        // If stream ended without explicit done/fast event
        if (streamingText && !gotFirstToken) {
          // Shouldn't happen, but safety net
          setMessages((prev) => [
            ...prev,
            {
              id: assistantMsgId,
              role: 'assistant',
              content: streamingText,
              timestamp: new Date(),
              mode: metaData.mode,
              suggestions: metaData.suggestions,
              cards: metaData.cards,
            },
          ])
        }

        retryCountRef.current = 0
        setStatus('online')
      } catch (err: any) {
        pushError(`Request failed: ${err.message}`)
        setStatus('offline')
      } finally {
        setLoading(false)
      }
    },
    [loading, messages],
  )

  // ── Retry connection (max 3, then silent) ────────────────────────

  const retryConnection = useCallback(async () => {
    if (retryCountRef.current >= 3) {
      pushError('Max retries reached. Please try again later.')
      return
    }
    retryCountRef.current++
    setStatus('connecting')
    try {
      const res = await fetch('/api/ai/health')
      const json = await res.json()
      setStatus(json.ok ? 'online' : 'offline')
      if (json.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `retry-ok-${Date.now()}`,
            role: 'assistant',
            content: `AI provider is back online (${json.defaultProvider}). You can ask your question now.`,
            timestamp: new Date(),
          },
        ])
        retryCountRef.current = 0
      } else {
        pushError('AI provider is still unavailable. Using DB-powered mode.')
      }
    } catch {
      setStatus('offline')
      pushError('Could not reach AI health endpoint.')
    }
  }, [])

  // ── Execute fix action (legacy) ──────────────────────────────────

  const executeAction = useCallback(async (actionKey: string, label: string) => {
    if (actionKey === 'retry') { retryConnection(); return }

    setLoading(true)
    setMessages((prev) => [
      ...prev,
      { id: `action-req-${Date.now()}`, role: 'user', content: `Execute: ${label}`, timestamp: new Date() },
    ])

    try {
      const res = await fetch(`/api/hr/ai/actions/${actionKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: true }),
      })
      const json = await res.json()

      if (json.success && json.data) {
        const result = json.data
        const lines = [result.message]
        if (result.changes?.length) { lines.push('', '**Changes:**'); result.changes.forEach((c: string) => lines.push(`- ${c}`)) }
        if (result.nextSteps?.length) { lines.push('', '**Next Steps:**'); result.nextSteps.forEach((s: string) => lines.push(`- ${s}`)) }
        setMessages((prev) => [
          ...prev,
          { id: `action-res-${Date.now()}`, role: 'assistant', content: lines.join('\n'), timestamp: new Date() },
        ])
      } else {
        pushError(`Action failed: ${json.error ?? 'Unknown error'}`)
      }
    } catch (err: any) {
      pushError(`Action request failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [retryConnection])

  // ── Handle key press ─────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(input)
      }
    },
    [input, sendMessage],
  )

  // ── Status chip renderer ─────────────────────────────────────────

  const statusClass: Record<ConnectionStatus, string> = {
    online: 'sera-ai-assistant-status--online',
    offline: 'sera-ai-assistant-status--offline',
    connecting: 'sera-ai-assistant-status--connecting',
  }

  const StatusChip = () => {
    const labels: Record<ConnectionStatus, string> = {
      online: 'Online',
      offline: 'DB Mode',
      connecting: 'Connecting',
    }
    return (
      <span className={cn('sera-ai-assistant-status', statusClass[status])}>
        <span className="sera-ai-assistant-status__dot" />
        {labels[status]}
        {status === 'connecting' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      </span>
    )
  }

  return (
    <>
      {/* ── Floating Button ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'sera-ai-assistant-fab relative fixed bottom-6 right-6 z-50 print:hidden',
          open && 'scale-0 opacity-0 pointer-events-none',
        )}
        aria-label="HR Assistant"
        title="HR Assistant"
      >
        <MessageSquare className="h-5 w-5" strokeWidth={1.85} aria-hidden />
        <span className="sr-only">Ask AI</span>
        {lastAudit && lastAudit.summary.missing > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sera-orange)] px-1 text-[10px] font-bold text-white">
            {lastAudit.summary.missing}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="sera-ai-assistant-sheet w-full sm:w-[440px] md:w-[480px] p-0 flex flex-col gap-0"
        >
          <header className="sera-ai-assistant-header">
            <div className="sera-ai-assistant-header__brand">
              <h2 className="sera-ai-assistant-header__title">HR Assistant</h2>
              <p className="sera-ai-assistant-header__subtitle">AI-powered HR helper</p>
            </div>
            <div className="sera-ai-assistant-header__actions">
              <StatusChip />
              <button
                type="button"
                onClick={runAudit}
                disabled={auditLoading}
                className="sera-ai-assistant-audit-btn inline-flex items-center"
              >
                {auditLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Audit
              </button>
            </div>
          </header>

          <ScrollArea className="sera-ai-assistant-body">
            <div className="sera-ai-assistant-chat">
              {messages.length === 0 && (
                <div>
                  <div className="sera-ai-assistant-welcome">
                    <h3 className="sera-ai-assistant-welcome__title">HR Assistant</h3>
                    <p className="sera-ai-assistant-welcome__desc">
                      Tanya apa sahaja tentang HR — pekerja, jabatan, gaji, cuti dan banyak lagi. I understand BM and English.
                    </p>
                  </div>
                  <div className="sera-ai-assistant-prompts">
                    {[
                      'Baki cuti saya?',
                      'Cuti umum tahun ini?',
                      'Bila gaji masuk?',
                      'Run HR audit',
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sendMessage(q)}
                        disabled={loading}
                        className="sera-ai-assistant-prompt"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg) => (
                <div key={msg.id}>
                  <div className={cn('sera-ai-assistant-msg-row', msg.role === 'user' ? 'sera-ai-assistant-msg-row--user' : 'sera-ai-assistant-msg-row--assistant')}>
                    <div
                      className={cn(
                        'sera-ai-assistant-bubble',
                        msg.role === 'user'
                          ? 'sera-ai-assistant-bubble--user'
                          : 'sera-ai-assistant-bubble--assistant',
                      )}
                    >
                      {/* Mode badge */}
                      {msg.mode && msg.role === 'assistant' && (
                        <div className="mb-1">
                          <ModeBadge mode={msg.mode} />
                        </div>
                      )}

                      {msg.isAuditCard && msg.auditData ? (
                        <AuditCard audit={msg.auditData} onAction={executeAction} />
                      ) : (
                        <MarkdownLite text={msg.content} />
                      )}

                      {/* Data cards */}
                      {msg.cards && msg.cards.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {msg.cards.map((card, ci) => (
                            <DataCard key={ci} card={card} />
                          ))}
                        </div>
                      )}

                      {/* Legacy suggested actions */}
                      {msg.suggested_actions && msg.suggested_actions.length > 0 && (
                        <div className="mt-2 space-y-1.5 pt-2 border-t border-border/30">
                          {msg.suggested_actions.map((action) => (
                            <button
                              key={action.key}
                              onClick={() => {
                                if (action.confirm_required) {
                                  if (window.confirm(`Execute "${action.label}"? This will make changes.`)) {
                                    executeAction(action.key, action.label)
                                  }
                                } else {
                                  executeAction(action.key, action.label)
                                }
                              }}
                              className="sera-ai-assistant-action-link"
                              disabled={loading}
                            >
                              <Wrench className="h-3 w-3" />
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Suggestion chips (below assistant message) */}
                  {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="sera-ai-assistant-chips">
                      {msg.suggestions.map((s, si) => (
                        <button
                          key={si}
                          type="button"
                          onClick={() => sendMessage(s.label)}
                          disabled={loading}
                          className="sera-ai-assistant-chip sera-ai-assistant-chip--sm"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Loading indicator — only shows before first token arrives */}
              {loading && (
                <div className="sera-ai-assistant-msg-row sera-ai-assistant-msg-row--assistant">
                  <div className="sera-ai-assistant-bubble sera-ai-assistant-bubble--loading">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="streaming-dots">Thinking</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom sentinel for autoscroll */}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          <footer className="sera-ai-assistant-footer">
            {status === 'offline' && messages.length > 2 && (
              <button type="button" onClick={retryConnection} className="sera-ai-assistant-retry">
                <RefreshCw className="h-3 w-3" />
                Try AI mode
              </button>
            )}
            <div className="sera-ai-assistant-composer">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tanya tentang HR… / Ask about HR…"
                className="sera-ai-assistant-input"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="sera-ai-assistant-send"
                aria-label="Send message"
              >
                Send
              </button>
            </div>
            <p className="sera-ai-assistant-footer-note">
              Data organisasi sahaja · AI + DB tools
            </p>
          </footer>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ─── Mode Badge ────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: AssistantResponse['mode'] }) {
  const modeClass: Record<string, string> = {
    tool: 'sera-ai-assistant-mode--tool',
    'ai+tool': 'sera-ai-assistant-mode--ai-tool',
    ai: 'sera-ai-assistant-mode--ai',
    offline: 'sera-ai-assistant-mode--offline',
  }
  const labels: Record<string, string> = {
    tool: 'DB Query',
    'ai+tool': 'AI + DB',
    ai: 'AI',
    offline: 'Offline',
  }
  return (
    <span className={cn('sera-ai-assistant-mode', modeClass[mode] ?? modeClass.ai)}>
      {labels[mode] ?? labels.ai}
    </span>
  )
}

// ─── Data Card (table from tool result) ────────────────────────────

function DataCard({ card }: { card: { title: string; rows: Record<string, any>[]; deepLink?: string } }) {
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? card.rows : card.rows.slice(0, 5)

  // Filter out internal fields (settingsLink, settingsLabel) from display headers
  const internalFields = ['settingsLink', 'settingsLabel']
  const headers = card.rows.length > 0
    ? Object.keys(card.rows[0]).filter((h) => !internalFields.includes(h))
    : []

  // Check if rows have settings links (audit-style rows)
  const hasSettingsLinks = card.rows.some((r) => r.settingsLink)

  return (
    <div className="sera-ai-assistant-data-card">
      <div className="sera-ai-assistant-data-card__head">
        <span>{card.title}</span>
        {card.deepLink && (
          <a href={card.deepLink} className="sera-ai-assistant-data-card__link">
            <ExternalLink className="h-2.5 w-2.5" />
            View
          </a>
        )}
      </div>
      {headers.length > 0 && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h} className="capitalize">
                    {h.replace(/([A-Z])/g, ' $1').trim()}
                  </th>
                ))}
                {hasSettingsLinks && (
                  <th>Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((h) => (
                    <td key={h}>{String(row[h] ?? '—')}</td>
                  ))}
                  {hasSettingsLinks && (
                    <td>
                      {row.settingsLink ? (
                        <a href={row.settingsLink} className="sera-ai-assistant-data-card__link">
                          <Wrench className="h-2.5 w-2.5" />
                          {row.settingsLabel ?? 'Fix'}
                        </a>
                      ) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {card.rows.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="sera-ai-assistant-data-card__expand"
        >
          {expanded ? 'Show less' : `Show all ${card.rows.length} rows`}
        </button>
      )}
    </div>
  )
}

// ─── Audit Card Sub-component ──────────────────────────────────────

function AuditCard({
  audit,
  onAction,
}: {
  audit: HrAuditResult
  onAction: (key: string, label: string) => void
}) {
  const [expanded, setExpanded] = useState<string[]>([])

  const toggleSection = (key: string) => {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  const statusIcon = (s: string) => {
    switch (s) {
      case 'configured': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      case 'partial': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      case 'missing': return <XCircle className="h-3.5 w-3.5 text-red-500" />
      default: return null
    }
  }

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      configured: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      missing: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }
    return (
      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', colors[s] ?? '')}>
        {s}
      </span>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="text-emerald-600">{audit.summary.configured} ok</span>
        <span className="text-amber-500">{audit.summary.partial} partial</span>
        <span className="text-red-500">{audit.summary.missing} missing</span>
        <span className="text-muted-foreground ml-auto">of {audit.summary.total}</span>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden flex">
        <div className="bg-emerald-500 transition-all" style={{ width: `${(audit.summary.configured / audit.summary.total) * 100}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${(audit.summary.partial / audit.summary.total) * 100}%` }} />
        <div className="bg-red-400 transition-all" style={{ width: `${(audit.summary.missing / audit.summary.total) * 100}%` }} />
      </div>

      <div className="space-y-1">
        {audit.sections.map((section) => {
          const isOpen = expanded.includes(section.key)
          return (
            <div key={section.key} className="rounded-lg border border-border/50 overflow-hidden">
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50 transition-colors"
              >
                {statusIcon(section.status)}
                <span className="flex-1 text-left">{section.label}</span>
                {statusBadge(section.status)}
                <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="px-2.5 pb-2 space-y-1">
                  {section.checks.map((check) => (
                    <div key={check.key} className="flex items-start gap-2 py-1 text-[11px]">
                      {statusIcon(check.status)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{check.label}</p>
                        <p className="text-muted-foreground">{check.detail}</p>
                        {check.fix_key && check.status !== 'configured' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`Apply fix: "${check.label}"?`)) onAction(check.fix_key!, check.label)
                            }}
                            className="sera-ai-assistant-action-link mt-0.5"
                          >
                            <Wrench className="h-2.5 w-2.5" />
                            Fix this
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Simple Markdown-like renderer ─────────────────────────────────

/** Render inline segments: **bold** and [link](url) */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // split by bold and markdown links
  const parts = text.split(/(\*\*.*?\*\*|\[.*?\]\(.*?\))/)
  return parts.map((seg, j) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return <strong key={`${keyPrefix}-${j}`}>{seg.replace(/\*\*/g, '')}</strong>
    }
    const linkMatch = seg.match(/^\[(.+?)\]\((.+?)\)$/)
    if (linkMatch) {
      return (
        <a
          key={`${keyPrefix}-${j}`}
          href={linkMatch[2]}
          className="text-violet-600 dark:text-violet-400 underline hover:text-violet-800 dark:hover:text-violet-200 font-medium"
        >
          {linkMatch[1]}
        </a>
      )
    }
    return <span key={`${keyPrefix}-${j}`}>{seg}</span>
  })
}

function MarkdownLite({ text }: { text: string }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(<p key={i} className="font-semibold mt-1">{line.replace(/\*\*/g, '')}</p>)
      return
    }
    if (line.includes('**') || line.match(/\[.+?\]\(.+?\)/)) {
      elements.push(
        <p key={i} className="mt-0.5">
          {renderInline(line, String(i))}
        </p>,
      )
      return
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      const content = line.replace(/^[-•]\s*/, '')
      elements.push(
        <p key={i} className="pl-3 relative">
          <span className="absolute left-0">•</span>
          {content.match(/\[.+?\]\(.+?\)/) ? renderInline(content, String(i)) : content}
        </p>,
      )
      return
    }
    if (line.match(/^[✅⚠️❌🔗]/)) {
      elements.push(<p key={i} className="mt-0.5">{renderInline(line, String(i))}</p>)
      return
    }
    if (!line.trim()) {
      elements.push(<br key={i} />)
      return
    }
    elements.push(<p key={i}>{renderInline(line, String(i))}</p>)
  })

  return <div className="space-y-0.5 leading-relaxed">{elements}</div>
}
