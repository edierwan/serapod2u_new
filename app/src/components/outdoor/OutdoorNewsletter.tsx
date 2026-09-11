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
    <form
      className={`flex flex-col sm:flex-row gap-3 w-full ${onDark ? 'max-w-md' : ''}`}
      onSubmit={submit}
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
        className={`flex-1 h-12 rounded-full px-4 text-sm disabled:opacity-70 ${
          onDark
            ? 'border border-white/35 bg-white/95 text-[var(--out-ink)] placeholder:text-[var(--out-muted)]'
            : 'border border-[var(--out-line)] bg-[var(--out-cream)]'
        }`}
      />
      <button
        type="submit"
        disabled={done || loading}
        className="h-12 rounded-full bg-[var(--out-moss)] px-5 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-50 shrink-0"
      >
        {done ? 'Registered' : loading ? 'Saving…' : 'Subscribe'}
      </button>
      {error ? (
        <p className={`text-sm w-full ${onDark ? 'text-red-200' : 'text-red-600'}`}>{error}</p>
      ) : null}
    </form>
  )
}
