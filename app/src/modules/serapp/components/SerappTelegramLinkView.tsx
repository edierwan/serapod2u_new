'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Copy, ExternalLink, Link2, Unlink } from 'lucide-react'

interface LinkTokenResponse {
  token?: string
  expiresAt?: string
  expiresInMinutes?: number
  deepLink?: string | null
  instructions?: string
  alreadyLinked?: boolean
  linkedAt?: string
  telegramUsername?: string | null
  error?: string
}

interface StatusResponse {
  linked: boolean
  botUsername?: string | null
  link?: {
    linkedAt: string
    telegramUsername: string | null
    telegramFirstName: string | null
    hasDraft: boolean
    lastOrderNo: string | null
  } | null
  error?: string
}

export default function SerappTelegramLinkView() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [tokenData, setTokenData] = useState<LinkTokenResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/telegram/status', { cache: 'no-store' })
    const json = (await res.json()) as StatusResponse
    if (!res.ok) throw new Error(json.error || 'Failed to load status')
    setStatus(json)
  }, [])

  useEffect(() => {
    startTransition(() => {
      loadStatus().catch(err => setError(err instanceof Error ? err.message : 'Load failed'))
    })
  }, [loadStatus])

  const generateCode = () => {
    setError(null)
    setTokenData(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/telegram/link-token', { method: 'POST' })
        const json = (await res.json()) as LinkTokenResponse
        if (!res.ok) throw new Error(json.error || 'Failed to generate code')
        setTokenData(json)
        await loadStatus()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate code')
      }
    })
  }

  const unlink = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/telegram/link-token', { method: 'DELETE' })
        const json = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(json.error || 'Failed to unlink')
        setTokenData(null)
        await loadStatus()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to unlink')
      }
    })
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // ignore
    }
  }

  const linked = status?.linked
  const botUsername = status?.botUsername

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[var(--sera-orange)]">
          <Link2 className="h-5 w-5" />
          <h1 className="text-lg font-semibold text-[var(--sera-ink)]">Official ordering · Telegram</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--sera-muted)]">
          Telegram is the official ordering channel. Link once here, then paste-check and submit only in Telegram.
          Prices are not shown in Telegram.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sera-muted)]">Status</p>
        {pending && !status ? (
          <p className="mt-2 text-sm text-[var(--sera-muted)]">Loading…</p>
        ) : linked ? (
          <div className="mt-2 space-y-1 text-sm">
            <p className="font-medium text-emerald-700">Linked ✓</p>
            {status?.link?.telegramUsername && (
              <p className="text-[var(--sera-muted)]">@{status.link.telegramUsername}</p>
            )}
            {status?.link?.lastOrderNo && (
              <p className="text-[var(--sera-muted)]">Last order: {status.link.lastOrderNo}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--sera-muted)]">Not linked yet</p>
        )}
      </section>

      {!linked && (
        <section className="mt-4 space-y-3">
          <button
            type="button"
            disabled={pending}
            onClick={generateCode}
            className="w-full rounded-xl bg-[var(--sera-orange)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Working…' : 'Generate link code'}
          </button>

          {tokenData?.token && (
            <div className="rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-paper)] p-4">
              <p className="text-xs text-[var(--sera-muted)]">Code (expires in {tokenData.expiresInMinutes} min)</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-[var(--sera-surface)] px-3 py-2 text-lg font-bold tracking-widest">
                  {tokenData.token}
                </code>
                <button
                  type="button"
                  onClick={() => copy(tokenData.token!)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--sera-line)]"
                  aria-label="Copy code"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-[var(--sera-muted)]">
                Send to the bot: <code className="text-[var(--sera-ink)]">/link {tokenData.token}</code>
              </p>
              {tokenData.deepLink && (
                <a
                  href={tokenData.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--sera-orange)]"
                >
                  Open in Telegram
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              {!botUsername && (
                <p className="mt-2 text-xs text-amber-700">
                  Set TELEGRAM_BOT_USERNAME on the server for one-tap deep links.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {linked && (
        <button
          type="button"
          disabled={pending}
          onClick={unlink}
          className="mt-4 inline-flex items-center gap-2 text-sm text-red-600 disabled:opacity-60"
        >
          <Unlink className="h-4 w-4" />
          Unlink Telegram
        </button>
      )}

      <section className="mt-8 rounded-2xl border border-dashed border-[var(--sera-line)] p-4 text-sm text-[var(--sera-muted)]">
        <p className="font-medium text-[var(--sera-ink-soft)]">Daily workflow (Telegram only)</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Open @SerapodOrdersBot and paste your order list</li>
          <li>Send /submit (or /confirm) — creates the order without reserving stock yet</li>
          <li>HQ approves in Current Orders → appears in Warehouse incoming</li>
          <li>After delivery: /receipts then /received or /report_difference</li>
          <li>/help for all commands — use this page only to link or unlink</li>
        </ul>
      </section>
    </div>
  )
}
