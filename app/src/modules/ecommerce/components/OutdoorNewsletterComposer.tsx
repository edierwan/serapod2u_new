'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  OUTDOOR_UPDATE_BODY_MAX,
  OUTDOOR_UPDATE_KINDS,
  OUTDOOR_UPDATE_LABELS,
  OUTDOOR_UPDATE_TITLE_MAX,
  outdoorUpdateLabel,
  outdoorUpdateLink,
  type OutdoorUpdateKind,
} from '@/lib/outdoor/newsletter-updates'

const API = '/api/outdoor/updates'

interface SentUpdate {
  id: string
  kind: string
  title: string
  body: string
  emailed_count: number
  created_at: string
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Staff write one email and send it to every active Outdoor newsletter subscriber. */
export function OutdoorNewsletterComposer() {
  const [kind, setKind] = useState<OutdoorUpdateKind>('product')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [subscribers, setSubscribers] = useState<number | null>(null)
  const [history, setHistory] = useState<SentUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'test' | 'send' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch(API)
    const data = await res.json().catch(() => null)
    if (res.status === 401) throw new Error('Only Outdoor store staff can send newsletter emails.')
    if (!res.ok) throw new Error(data?.error || 'Could not load past updates.')
    setSubscribers(Number(data?.subscribers) || 0)
    setHistory(Array.isArray(data?.updates) ? data.updates : [])
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch(err => { if (!cancelled) setError(err.message || 'Could not load past updates.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const linkCheck = outdoorUpdateLink(link, origin)
  const problem = !title.trim()
    ? 'Write a title.'
    : body.trim().length < 2
      ? 'Write the message.'
      : linkCheck.error || null

  const send = async (test: boolean) => {
    setBusy(test ? 'test' : 'send')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title: title.trim(), body: body.trim(), link: link.trim(), test }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not send this email.')
      if (test) {
        setNotice(`Test sent to ${data?.to || 'your email'}. Check your inbox before sending to everyone.`)
      } else {
        setNotice(`Sent to ${data?.emailed ?? 0} of ${data?.subscribers ?? 0} subscribers.`)
        setTitle('')
        setBody('')
        setLink('')
        await load().catch(() => {})
      }
    } catch (err: any) {
      setError(err?.message || 'Could not send this email.')
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const count = subscribers ?? 0
  const disabled = Boolean(problem) || busy !== null

  return (
    <div className="space-y-4">
      <div className="sera-sc-panel space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Email your subscribers</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Subscribers only get the welcome email automatically. Use this to tell them about a new product, an offer, free shipping or an event.
            It goes to {count} active subscriber{count === 1 ? '' : 's'}, each with their own unsubscribe link.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="block text-xs font-medium text-muted-foreground">
            Type
            <select
              value={kind}
              onChange={e => setKind(e.target.value as OutdoorUpdateKind)}
              className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white px-2 py-2 text-sm text-foreground"
            >
              {OUTDOOR_UPDATE_KINDS.map(value => (
                <option key={value} value={value}>{OUTDOOR_UPDATE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Title
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, OUTDOOR_UPDATE_TITLE_MAX))}
              placeholder="Free shipping this weekend"
              className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-muted-foreground">
          Message
          <textarea
            value={body}
            onChange={e => setBody(e.target.value.slice(0, OUTDOOR_UPDATE_BODY_MAX))}
            rows={5}
            placeholder="Tell subscribers what is new and until when."
            className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white p-3 text-sm text-foreground"
          />
        </label>

        <label className="block text-xs font-medium text-muted-foreground">
          Button link (optional)
          <input
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="/outdoor/shop/… or https://…"
            className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white px-3 py-2 text-sm text-foreground"
          />
          <span className="mt-1 block font-normal">Leave empty to link to the Outdoor shop.</span>
        </label>

        <div className="rounded-lg border border-border bg-white p-4" data-testid="newsletter-preview">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Preview</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#3f1c1f]">{outdoorUpdateLabel(kind)}</p>
          <p className="mt-1 font-serif text-xl text-foreground">{title.trim() || 'Your title'}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{body.trim() || 'Your message'}</p>
          <span className="mt-3 inline-block rounded-full bg-[#3f1c1f] px-4 py-1.5 text-xs font-bold text-white">
            {linkCheck.url ? 'Take a look' : 'Visit the shop'}
          </span>
        </div>

        {problem && (title || body || link) ? <p className="text-xs text-destructive">{problem}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-900">
              Send this email to {count} subscriber{count === 1 ? '' : 's'} now? It cannot be undone.
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => send(false)}
              className="rounded-lg bg-[var(--sera-orange,#f97316)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === 'send' ? 'Sending… this can take a minute' : 'Yes, send it'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => send(true)}
              className="rounded-lg border border-[var(--sera-line)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy === 'test' ? 'Sending test…' : 'Send a test to me'}
            </button>
            <button
              type="button"
              disabled={disabled || count === 0}
              onClick={() => { setNotice(null); setConfirming(true) }}
              className="rounded-lg bg-[var(--sera-orange,#f97316)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Send to {count} subscriber{count === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>

      {history.length > 0 ? (
        <div className="sera-sc-panel p-4">
          <h3 className="text-sm font-semibold text-foreground">Sent emails</h3>
          <ul className="mt-2 divide-y divide-border">
            {history.map(item => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-foreground">
                  <span className="mr-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{outdoorUpdateLabel(item.kind)}</span>
                  {item.title}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDate(item.created_at)} · {item.emailed_count} emailed
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
