'use client'

import { useState } from 'react'

export default function OutdoorNewsletter({
  variant = 'default',
}: {
  variant?: 'default' | 'onDark'
}) {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const onDark = variant === 'onDark'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'outdoor_home' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not subscribe')
      setDone(true)
    } catch (err: any) {
      setError(err.message || 'Could not subscribe')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={`w-full ${onDark ? 'max-w-md' : ''}`} onSubmit={submit}>
      <div
        className={`flex items-center rounded-full border p-1 ${
          onDark
            ? 'border-white/50 bg-white'
            : 'border-[var(--out-ink)] bg-white'
        }`}
      >
        <label className="sr-only" htmlFor="outdoor-newsletter">Email</label>
        <input
          id="outdoor-newsletter"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          disabled={done || loading}
          className="min-w-0 flex-1 h-10 bg-transparent px-4 text-sm text-[var(--out-ink)] placeholder:text-[var(--out-muted)] outline-none disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={done || loading}
          className="h-10 shrink-0 rounded-full bg-[var(--out-moss)] px-5 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-50"
        >
          {done ? 'Registered' : loading ? 'Saving…' : 'Subscribe'}
        </button>
      </div>
      {error ? (
        <p className={`mt-2 text-sm ${onDark ? 'text-red-200' : 'text-red-600'}`}>{error}</p>
      ) : null}
    </form>
  )
}
