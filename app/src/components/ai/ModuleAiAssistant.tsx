'use client'

/**
 * Module AI Assistant – Generic Floating Button + Chat Drawer
 *
 * Reusable AI assistant for Finance, Supply Chain, and Customer & Growth modules.
 * Each module passes its own config (title, color, system prompt context, API endpoint).
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bot,
  Send,
  RefreshCw,
  Loader2,
  Sparkles,
  Wifi,
  WifiOff,
  Zap,
  ExternalLink,
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
  /** Gradient colors for the floating button and header */
  gradientFrom: string
  gradientTo: string
  /** Accent color classes for chips/badges */
  accentBg: string
  accentText: string
  accentBorder: string
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
  gradientFrom: 'from-emerald-600',
  gradientTo: 'to-teal-600',
  accentBg: 'bg-emerald-50 dark:bg-emerald-950/30',
  accentText: 'text-emerald-700 dark:text-emerald-300',
  accentBorder: 'border-emerald-200 dark:border-emerald-800',
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
  gradientFrom: 'from-orange-600',
  gradientTo: 'to-amber-600',
  accentBg: 'bg-orange-50 dark:bg-orange-950/30',
  accentText: 'text-orange-700 dark:text-orange-300',
  accentBorder: 'border-orange-200 dark:border-orange-800',
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
  gradientFrom: 'from-pink-600',
  gradientTo: 'to-rose-600',
  accentBg: 'bg-pink-50 dark:bg-pink-950/30',
  accentText: 'text-pink-700 dark:text-pink-300',
  accentBorder: 'border-pink-200 dark:border-pink-800',
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

  // ── Autoscroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ── Focus input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  // ── Listen for toggle event from top nav
  useEffect(() => {
    const handler = () => setOpen((prev) => !prev)
    window.addEventListener(config.toggleEvent, handler)
    return () => window.removeEventListener(config.toggleEvent, handler)
  }, [config.toggleEvent])

  // ── Health poll (every 60s)
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/ai/health')
        const json = await res.json()
        if (mounted) {
          setStatus(json.ok ? 'online' : 'offline')
        }
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

  // ── Send message
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
        const history = messages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        const res = await fetch(`/api/module-assistant/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            history,
            moduleId: config.moduleId,
          }),
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
    [loading, messages, config.moduleId],
  )

  // ── Retry connection
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

  // ── Status chip
  const StatusChip = () => {
    const configs: Record<ConnectionStatus, { label: string; icon: typeof Wifi; cls: string }> = {
      online: { label: 'AI Online', icon: Wifi, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
      offline: { label: 'Offline', icon: WifiOff, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
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

  // ── Mode badge
  const ModeBadge = ({ mode }: { mode: AssistantResponse['mode'] }) => {
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

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center justify-center',
          'h-14 w-14 rounded-full shadow-lg transition-all duration-300',
          `bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} text-white`,
          'hover:shadow-xl hover:scale-105 active:scale-95',
          'print:hidden',
          open && 'scale-0 opacity-0 pointer-events-none',
        )}
        aria-label={config.title}
        title={config.title}
      >
        <Bot className="h-6 w-6" />
      </button>

      {/* Drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:w-[440px] md:w-[480px] p-0 flex flex-col"
        >
          {/* Header */}
          <SheetHeader className={cn('px-4 py-3 border-b border-border', config.accentBg)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn('flex items-center justify-center h-8 w-8 rounded-lg text-white', `bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo}`)}>
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-semibold">{config.title}</SheetTitle>
                  <p className="text-[11px] text-muted-foreground">{config.subtitle}</p>
                </div>
              </div>
              <StatusChip />
            </div>
          </SheetHeader>

          {/* Chat Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-4">
              {/* Welcome */}
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="text-center space-y-2 py-4">
                    <div className="flex justify-center">
                      <div className={cn('flex items-center justify-center h-12 w-12 rounded-full', config.accentBg)}>
                        <Bot className={cn('h-6 w-6', config.accentText)} />
                      </div>
                    </div>
                    <h3 className="text-sm font-semibold">{config.title}</h3>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      {config.welcomeMessage}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {config.quickSuggestions.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        disabled={loading}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                          config.accentBorder, config.accentText, config.accentBg,
                          'hover:opacity-80',
                        )}
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
                      {msg.mode && msg.role === 'assistant' && (
                        <div className="mb-1">
                          <ModeBadge mode={msg.mode} />
                        </div>
                      )}
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

                  {/* Suggestion chips */}
                  {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                      {msg.suggestions.map((s, si) => (
                        <button
                          key={si}
                          onClick={() => sendMessage(s.label)}
                          disabled={loading}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50',
                            config.accentBorder, config.accentText, config.accentBg,
                          )}
                        >
                          <Zap className="h-2.5 w-2.5" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Loading */}
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

              <div ref={endRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border p-3 bg-card">
            {status === 'offline' && messages.length > 2 && (
              <button
                onClick={retryConnection}
                className="text-[11px] text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Retry AI connection
              </button>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.placeholder}
                className={cn(
                  'flex-1 bg-muted rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground',
                  'focus:ring-2 focus:ring-violet-500/50',
                )}
                disabled={loading}
              />
              <Button
                size="icon"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className={cn('h-9 w-9 shrink-0', `bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo}`, 'hover:opacity-90')}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              AI + DB tools • Your organization data only
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ─── Data Card ─────────────────────────────────────────────────────

function DataCard({ card }: { card: { title: string; rows: Record<string, any>[]; deepLink?: string } }) {
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? card.rows : card.rows.slice(0, 5)
  const headers = card.rows.length > 0 ? Object.keys(card.rows[0]) : []

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

// ─── Simple Markdown renderer ──────────────────────────────────────

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
