'use client'

import { useState } from 'react'

export default function OutdoorUnsubscribe({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not unsubscribe')
      setDone(true)
    } catch (err: any) {
      setError(err.message || 'Could not unsubscribe')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return <p className="mt-6 text-sm text-red-600">This unsubscribe link is not valid.</p>
  }

  if (done) {
    return (
      <p className="mt-6 text-sm font-medium text-emerald-700">
        You are unsubscribed. Outdoor product emails will stop for this address.
      </p>
    )
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Unsubscribe'}
      </button>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
