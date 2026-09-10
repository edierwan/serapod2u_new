'use client'

import { useState } from 'react'

export default function OutdoorContactForm() {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', message: '' })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not send message')
      setSent(true)
      setForm({ name: '', email: '', message: '' })
    } catch (err: any) {
      setError(err.message || 'Could not send message')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="mt-10 space-y-4" onSubmit={submit}>
      <label className="block text-sm">
        Name
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          disabled={loading}
          className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3"
        />
      </label>
      <label className="block text-sm">
        Email
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          disabled={loading}
          className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3"
        />
      </label>
      <label className="block text-sm">
        Message
        <textarea
          required
          rows={5}
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          disabled={loading}
          className="mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? 'Sending…' : sent ? 'Send another' : 'Send message'}
      </button>
      {sent ? (
        <p className="text-sm text-[var(--out-moss)]">
          Thanks — your message was received. Our team will follow up by email.
        </p>
      ) : null}
    </form>
  )
}
