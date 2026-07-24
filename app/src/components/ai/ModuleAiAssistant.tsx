'use client'

/**
 * Module AI Assistant – Generic Floating Button + Chat Drawer
 *
 * Reusable AI assistant for Finance, Supply Chain, and Customer & Growth modules.
 * Each module passes its own config (title, API context, suggestions).
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  Loader2,
  ExternalLink,
  MessageSquare,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────

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

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  suggestions?: AssistantResponse['suggestions']
  cards?: AssistantResponse['cards']
  mode?: AssistantResponse['mode']
}

type ConnectionStatus = 'online' | 'offline' | 'connecting'

// ─── Config ────────────────────────────────────────────────────────

export interface ModuleAiAssistantConfig {
  /** Module ID used for API routing */
  moduleId: 'finance' | 'supply-chain' | 'customer-growth'
  /** Display title in the drawer header */
  title: string
  /** Subtitle text */
  subtitle: string
  /** Placeholder text for input */
  placeholder: string
  /** Welcome message */
  welcomeMessage: string
  /** Quick suggestion chips */
  quickSuggestions: string[]
  /** Event name for toggle from top nav */
  toggleEvent: string
}

// ─── Pre-built configs ─────────────────────────────────────────────

export const financeAssistantConfig: ModuleAiAssistantConfig = {
  moduleId: 'finance',
  title: 'Finance Assistant',
  subtitle: 'AI-powered finance helper',
  placeholder: 'Ask about finance… / Tanya tentang kewangan…',
  welcomeMessage: 'Ask me anything about finance — GL journals, invoices, payments, reports and more. I understand BM and English.',
  quickSuggestions: [
    'Trial balance summary?',
    'Pending journal postings?',
    'Outstanding AR invoices?',
    'AP aging report?',
  ],
  toggleEvent: 'finance-ai-assistant-toggle',
}

export const supplyChainAssistantConfig: ModuleAiAssistantConfig = {
  moduleId: 'supply-chain',
  title: 'Supply Chain Assistant',
  subtitle: 'AI-powered supply chain helper',
  placeholder: 'Ask about supply chain… / Tanya tentang rantaian bekalan…',
  welcomeMessage: 'Ask me anything about supply chain — products, orders, inventory, QR tracking and more. I understand BM and English.',
  quickSuggestions: [
    'Total products?',
    'Pending orders?',
    'Low stock items?',
    'Recent QR batches?',
  ],
  toggleEvent: 'supply-chain-ai-assistant-toggle',
}

export const customerGrowthAssistantConfig: ModuleAiAssistantConfig = {
  moduleId: 'customer-growth',
  title: 'Customer & Growth Assistant',
  subtitle: 'AI-powered CRM & marketing helper',
  placeholder: 'Ask about customers… / Tanya tentang pelanggan…',
  welcomeMessage: 'Ask me anything about CRM, marketing, loyalty programs and more. I understand BM and English.',
  quickSuggestions: [
    'Total consumers?',
    'Recent activations?',
    'Active campaigns?',
    'Points distributed?',
  ],
  toggleEvent: 'customer-growth-ai-assistant-toggle',
}

// ─── Shared UI helpers ─────────────────────────────────────────────

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  online: 'sera-ai-assistant-status--online',
  offline: 'sera-ai-assistant-status--offline',
  connecting: 'sera-ai-assistant-status--connecting',
}

const MODE_CLASS: Record<string, string> = {
  tool: 'sera-ai-assistant-mode--tool',
  'ai+tool': 'sera-ai-assistant-mode--ai-tool',
  ai: 'sera-ai-assistant-mode--ai',
  offline: 'sera-ai-assistant-mode--offline',
}

function StatusChip({ status }: { status: ConnectionStatus }) {
  const labels: Record<ConnectionStatus, string> = {
    online: 'Online',
    offline: 'Offline',
    connecting: 'Connecting',
  }
  return (
    <span className={cn('sera-ai-assistant-status', STATUS_CLASS[status])}>
      <span className="sera-ai-assistant-status__dot" />
      {labels[status]}
      {status === 'connecting' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
    </span>
  )
}

function ModeBadge({ mode }: { mode: AssistantResponse['mode'] }) {
  const labels: Record<string, string> = {
    tool: 'DB Query',
    'ai+tool': 'AI + DB',
    ai: 'AI',
    offline: 'Offline',
  }
  return (
    <span className={cn('sera-ai-assistant-mode', MODE_CLASS[mode] ?? MODE_CLASS.ai)}>
      {labels[mode] ?? labels.ai}
    </span>
  )
}

// ─── Component ─────────────────────────────────────────────────────

interface ModuleAiAssistantProps {
  config: ModuleAiAssistantConfig
}

export default function ModuleAiAssistant({ config }: ModuleAiAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const retryCountRef = useRef(0)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  useEffect(() => {
    const handler = () => setOpen((prev) => !prev)
    window.addEventListener(config.toggleEvent, handler)
    return () => window.removeEventListener(config.toggleEvent, handler)
  }, [config.toggleEvent])

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/ai/health')
        const json = await res.json()
        if (mounted) setStatus(json.ok ? 'online' : 'offline')
      } catch {
        if (mounted) setStatus('offline')
      }
    }
    check()
    const iv = setInterval(check, 60_000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  const pushError = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `err-${Date.now()}`, role: 'assistant', content, timestamp: new Date() },
    ])
  }

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
        const history = messages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        const res = await fetch(`/api/module-assistant/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            history,
            moduleId: config.moduleId,
          }),
        })

        if (!res.ok || !res.body) {
          const batchRes = await fetch('/api/module-assistant/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text.trim(), history, moduleId: config.moduleId }),
          })
          const json = await batchRes.json()
          if (json.success && json.data) {
            const data = json.data as AssistantResponse
            retryCountRef.current = 0
            setStatus(data.mode === 'offline' ? 'offline' : 'online')
            setMessages((prev) => [
              ...prev,
              { id: assistantMsgId, role: 'assistant', content: data.reply, timestamp: new Date(), suggestions: data.suggestions, cards: data.cards, mode: data.mode },
            ])
          } else {
            pushError(json.error ?? 'Failed to get response.')
          }
          setLoading(false)
          return
        }

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
            if (line.startsWith('event: ')) continue
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6)

            try {
              const parsed = JSON.parse(jsonStr)

              if ('t' in parsed) {
                streamingText += parsed.t
                if (!gotFirstToken) {
                  gotFirstToken = true
                  setMessages((prev) => [
                    ...prev,
                    { id: assistantMsgId, role: 'assistant', content: streamingText, timestamp: new Date(), mode: metaData.mode },
                  ])
                  setLoading(false)
                } else {
                  setMessages((prev) =>
                    prev.map((m) => m.id === assistantMsgId ? { ...m, content: streamingText } : m),
                  )
                }
              } else if ('reply' in parsed && 'suggestions' in parsed) {
                retryCountRef.current = 0
                setStatus(parsed.mode === 'offline' ? 'offline' : 'online')
                setMessages((prev) => {
                  const existing = prev.find((m) => m.id === assistantMsgId)
                  if (existing) {
                    return prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: parsed.reply || streamingText, suggestions: parsed.suggestions, cards: parsed.cards, mode: parsed.mode }
                        : m,
                    )
                  }
                  return [
                    ...prev,
                    { id: assistantMsgId, role: 'assistant' as const, content: parsed.reply || streamingText, timestamp: new Date(), suggestions: parsed.suggestions, cards: parsed.cards, mode: parsed.mode },
                  ]
                })
                setLoading(false)
              } else if ('reply' in parsed && 'metrics' in parsed) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: parsed.reply || streamingText, suggestions: metaData.suggestions, cards: metaData.cards, mode: metaData.mode }
                      : m,
                  ),
                )
                setLoading(false)
              } else if ('error' in parsed) {
                if (streamingText) {
                  setMessages((prev) =>
                    prev.map((m) => m.id === assistantMsgId ? { ...m, content: streamingText + '\n\n⚠️ ' + parsed.error } : m),
                  )
                } else {
                  pushError(parsed.error)
                }
                setLoading(false)
              } else if ('mode' in parsed && 'lang' in parsed) {
                metaData = parsed
              }
            } catch { /* malformed JSON — skip */ }
          }
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
    [loading, messages, config.moduleId],
  )

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
            content: `AI provider is back online. You can ask your question now.`,
            timestamp: new Date(),
          },
        ])
        retryCountRef.current = 0
      } else {
        pushError('AI provider is still unavailable.')
      }
    } catch {
      setStatus('offline')
      pushError('Could not reach AI health endpoint.')
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(input)
      }
    },
    [input, sendMessage],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'sera-ai-assistant-fab fixed bottom-6 right-6 z-50 print:hidden',
          open && 'scale-0 opacity-0 pointer-events-none',
        )}
        aria-label={config.title}
        title={config.title}
      >
        <MessageSquare className="h-5 w-5" strokeWidth={1.85} aria-hidden />
        <span className="sr-only">Ask AI</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="sera-ai-assistant-sheet w-full sm:w-[440px] md:w-[480px] p-0 flex flex-col gap-0"
        >
          <header className="sera-ai-assistant-header">
            <div className="sera-ai-assistant-header__brand">
              <h2 className="sera-ai-assistant-header__title">{config.title}</h2>
              <p className="sera-ai-assistant-header__subtitle">{config.subtitle}</p>
            </div>
            <div className="sera-ai-assistant-header__actions">
              <StatusChip status={status} />
            </div>
          </header>

          <ScrollArea className="sera-ai-assistant-body">
            <div className="sera-ai-assistant-chat">
              {messages.length === 0 && (
                <div>
                  <div className="sera-ai-assistant-welcome">
                    <h3 className="sera-ai-assistant-welcome__title">{config.title}</h3>
                    <p className="sera-ai-assistant-welcome__desc">{config.welcomeMessage}</p>
                  </div>
                  <div className="sera-ai-assistant-prompts">
                    {config.quickSuggestions.map((q) => (
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

              {messages.map((msg) => (
                <div key={msg.id}>
                  <div className={cn('sera-ai-assistant-msg-row', msg.role === 'user' ? 'sera-ai-assistant-msg-row--user' : 'sera-ai-assistant-msg-row--assistant')}>
                    <div className={cn('sera-ai-assistant-bubble', msg.role === 'user' ? 'sera-ai-assistant-bubble--user' : 'sera-ai-assistant-bubble--assistant')}>
                      {msg.mode && msg.role === 'assistant' && <ModeBadge mode={msg.mode} />}
                      <MarkdownLite text={msg.content} />
                      {msg.cards && msg.cards.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {msg.cards.map((card, ci) => (
                            <DataCard key={ci} card={card} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

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

              {loading && (
                <div className="sera-ai-assistant-msg-row sera-ai-assistant-msg-row--assistant">
                  <div className="sera-ai-assistant-bubble sera-ai-assistant-bubble--loading">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Thinking</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={endRef} />
            </div>
          </ScrollArea>

          <footer className="sera-ai-assistant-footer">
            {status === 'offline' && messages.length > 2 && (
              <button type="button" onClick={retryConnection} className="sera-ai-assistant-retry">
                <RefreshCw className="h-3 w-3" />
                Retry AI connection
              </button>
            )}
            <div className="sera-ai-assistant-composer">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.placeholder}
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
              Organization data only · AI + DB tools
            </p>
          </footer>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DataCard({ card }: { card: { title: string; rows: Record<string, any>[]; deepLink?: string } }) {
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? card.rows : card.rows.slice(0, 5)
  const headers = card.rows.length > 0 ? Object.keys(card.rows[0]) : []

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
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((h) => (
                    <td key={h}>{String(row[h] ?? '—')}</td>
                  ))}
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

function MarkdownLite({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(<p key={i} className="font-semibold mt-1">{line.replace(/\*\*/g, '')}</p>)
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(<p key={i} className="pl-3 relative"><span className="absolute left-0">•</span>{line.replace(/^[-•]\s*/, '')}</p>)
    } else if (!line.trim()) {
      elements.push(<br key={i} />)
    } else {
      elements.push(<p key={i}>{line}</p>)
    }
  })

  return <div className="space-y-0.5 leading-relaxed">{elements}</div>
}
