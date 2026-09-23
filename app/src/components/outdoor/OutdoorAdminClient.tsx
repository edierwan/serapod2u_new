'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type UpdateRow = {
  id: string
  kind: string
  title: string
  body: string
  emailed_count: number
  created_at: string
}

const KINDS = [
  { value: 'product', label: 'New product' },
  { value: 'color', label: 'New color' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other update' },
]

export default function OutdoorAdminClient() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [subscribers, setSubscribers] = useState(0)
  const [updates, setUpdates] = useState<UpdateRow[]>([])
  const [kind, setKind] = useState('product')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const access = await fetch('/api/outdoor/fulfilment/access')
    const accessData = await access.json().catch(() => null)
    if (!accessData?.allowed) {
      setAllowed(false)
      return
    }
    setAllowed(true)
    const res = await fetch('/api/outdoor/updates')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error || 'Could not load updates')
      return
    }
    setUpdates(data.updates || [])
    setSubscribers(data.subscribers || 0)
  }

  useEffect(() => {
    void load()
  }, [])

  const publish = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch('/api/outdoor/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title, body }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not publish')
      setTitle('')
      setBody('')
      setMessage(`Sent to ${data.emailed} subscriber${data.emailed === 1 ? '' : 's'}.`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not publish')
    } finally {
      setSaving(false)
    }
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-3xl">Staff only</h1>
        <Link href="/outdoor/shop" className="mt-6 inline-block font-semibold text-[var(--out-moss)]">Back to shop</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--out-muted)]">Admin</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Outdoor desk</h1>
      <p className="mt-2 text-sm text-[var(--out-muted)]">
        {subscribers} newsletter subscriber{subscribers === 1 ? '' : 's'}. A new product, color, event, or any update is emailed to them.
      </p>
      <div className="mt-4 flex gap-4 text-sm font-semibold">
        <Link href="/outdoor/fulfilment" className="text-[var(--out-moss)]">Follow orders</Link>
        <Link href="/outdoor/fulfilment?tab=inbox" className="text-[var(--out-moss)]">Messages</Link>
      </div>

      <form onSubmit={publish} className="mt-8 space-y-4 rounded-2xl border border-[var(--out-line)] bg-white p-5">
        <label className="block text-sm">
          What are you adding?
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3">
            {KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3" />
        </label>
        <label className="block text-sm">
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={5} className="mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2" />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
        <button type="submit" disabled={saving} className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Sending…' : 'Publish and email subscribers'}
        </button>
      </form>

      <ul className="mt-8 space-y-3">
        {updates.map((item) => (
          <li key={item.id} className="rounded-xl border border-[var(--out-line)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--out-muted)]">{item.kind}</p>
            <p className="mt-1 font-semibold">{item.title}</p>
            <p className="mt-1 text-sm text-[var(--out-ink-soft)] whitespace-pre-wrap">{item.body}</p>
            <p className="mt-2 text-xs text-[var(--out-muted)]">
              {new Date(item.created_at).toLocaleString()} · emailed {item.emailed_count}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
