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
  Bot,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Wrench,
  ExternalLink,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
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
          } else if (json.providers?.openclaw?.authenticated || json.providers?.ollama?.ok) {
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

  // ── Send message (new endpoint) ──────────────────────────────────

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

      try {
        // Build conversation history (last 10 messages)
        const history = messages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        const res = await fetch('/api/hr/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim(), history }),
        })

        const json = await res.json()

        if (json.success && json.data) {
          const data = json.data as AssistantResponse
          retryCountRef.current = 0
          setStatus(data.mode === 'offline' ? 'offline' : 'online')

          setMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
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

  const StatusChip = () => {
    const configs: Record<ConnectionStatus, { label: string; icon: typeof Wifi; cls: string }> = {
      online: { label: 'AI Online', icon: Wifi, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
      offline: { label: 'DB Mode', icon: Zap, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
      connecting: { label: 'Connecting', icon: Loader2, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
    }
    const cfg = configs[status]
    const Icon = cfg.icon
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full', cfg.cls)}>
        <Icon className={cn('h-2.5 w-2.5', status === 'connecting' && 'animate-spin')} />
        {cfg.label}
      </span>
    )
  }

  return (
    <>
      {/* ── Floating Button ─────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center justify-center',
          'h-14 w-14 rounded-full shadow-lg transition-all duration-300',
          'bg-gradient-to-br from-violet-600 to-blue-600 text-white',
          'hover:shadow-xl hover:scale-105 active:scale-95',
          'print:hidden',
          open && 'scale-0 opacity-0 pointer-events-none',
        )}
        aria-label="HR Assistant"
        title="HR Assistant"
      >
        <Bot className="h-6 w-6" />
        {lastAudit && lastAudit.summary.missing > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {lastAudit.summary.missing}
          </span>
        )}
      </button>

      {/* ── Drawer / Sheet ──────────────────────────────────────── */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:w-[440px] md:w-[480px] p-0 flex flex-col"
        >
          {/* Header */}
          <SheetHeader className="px-4 py-3 border-b border-border bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-semibold">HR Assistant</SheetTitle>
                  <p className="text-[11px] text-muted-foreground">AI-powered HR helper</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusChip />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={runAudit}
                  disabled={auditLoading}
                  className="h-7 px-2 text-xs"
                >
                  {auditLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Audit
                </Button>
              </div>
            </div>
          </SheetHeader>

          {/* Chat Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-4">
              {/* Welcome message when empty */}
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="text-center space-y-2 py-4">
                    <div className="flex justify-center">
                      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/40 dark:to-blue-900/40">
                        <Bot className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                      </div>
                    </div>
                    <h3 className="text-sm font-semibold">HR Assistant</h3>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      Tanya apa sahaja tentang HR — pekerja, jabatan, gaji, cuti dan banyak lagi. I understand BM and English.
                    </p>
                  </div>

                  {/* Welcome suggestion chips */}
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {[
                      'Baki cuti saya?',
                      'Cuti umum tahun ini?',
                      'Bila gaji masuk?',
                      'Run HR audit',
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        disabled={loading}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                      >
                        <Zap className="h-3 w-3" />
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg) => (
                <div key={msg.id}>
                  <div className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm',
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-muted rounded-bl-sm',
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
                              className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
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
                    <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                      {msg.suggestions.map((s, si) => (
                        <button
                          key={si}
                          onClick={() => sendMessage(s.label)}
                          disabled={loading}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors disabled:opacity-50"
                        >
                          <Zap className="h-2.5 w-2.5" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Loading indicator */}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-4 py-3 rounded-bl-sm">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Thinking…</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom sentinel for autoscroll */}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="border-t border-border p-3 bg-card">
            {/* Retry AI connection — only show if user specifically wants AI */}
            {status === 'offline' && messages.length > 2 && (
              <button
                onClick={retryConnection}
                className="text-[11px] text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Try AI mode
              </button>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tanya tentang HR… / Ask about HR…"
                className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-violet-500/50"
                disabled={loading}
              />
              <Button
                size="icon"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="h-9 w-9 shrink-0 bg-violet-600 hover:bg-violet-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              AI + DB tools • Data organisasi anda sahaja
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ─── Mode Badge ────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: AssistantResponse['mode'] }) {
  const configs: Record<string, { label: string; cls: string }> = {
    tool: { label: 'DB Query', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    'ai+tool': { label: 'AI + DB', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
    ai: { label: 'AI', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    offline: { label: 'Offline', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  }
  const cfg = configs[mode] ?? configs.ai
  return (
    <span className={cn('inline-block text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded', cfg.cls)}>
      {cfg.label}
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
    <div className="rounded-lg border border-border/50 bg-card text-card-foreground overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 text-xs font-medium bg-accent/30">
        <span>{card.title}</span>
        {card.deepLink && (
          <a href={card.deepLink} className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
            <ExternalLink className="h-2.5 w-2.5" />
            View
          </a>
        )}
      </div>
      {headers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/50">
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium text-muted-foreground capitalize">
                    {h.replace(/([A-Z])/g, ' $1').trim()}
                  </th>
                ))}
                {hasSettingsLinks && (
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/20 last:border-0">
                  {headers.map((h) => (
                    <td key={h} className="px-2 py-1 whitespace-nowrap">
                      {String(row[h] ?? '—')}
                    </td>
                  ))}
                  {hasSettingsLinks && (
                    <td className="px-2 py-1 whitespace-nowrap">
                      {row.settingsLink ? (
                        <a
                          href={row.settingsLink}
                          className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 text-[10px] font-medium"
                        >
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
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-1 border-t border-border/20"
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
                            className="mt-0.5 text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
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
