'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient, forceCleanStorage, resetClient } from '@/lib/supabase/client'
import StoreBrandMark from '@/components/storefront/StoreBrandMark'

function safeOutdoorNext(raw: string | null) {
  if (!raw) return '/outdoor/account'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/api/')) return '/outdoor/account'
  if (raw.startsWith('/outdoor')) return raw
  return '/outdoor/account'
}

export default function OutdoorLoginClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState('/outdoor/account')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = safeOutdoorNext(params.get('next') || params.get('redirect'))
    setNextPath(next)

    const check = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // Already signed in as shopper — continue to Outdoor destination
      window.location.href = next
    }
    void check()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      forceCleanStorage()
      resetClient()
      const supabase = createClient()
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signError) throw new Error(signError.message)

      const res = await fetch(`/api/auth/post-login-redirect?next=${encodeURIComponent(nextPath)}`)
      const data = await res.json().catch(() => null)
      window.location.href = data?.redirectTo || nextPath
    } catch (err: any) {
      setError(err.message || 'Could not sign in')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16 sm:py-20">
      <Link href="/outdoor" className="inline-flex">
        <StoreBrandMark className="h-8 w-auto" />
      </Link>
      <h1 className="mt-8 font-display text-3xl tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--out-muted)]">
        Sign in to checkout and view your Outdoor orders.
      </p>

      <form className="mt-8 space-y-4" onSubmit={submit}>
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-md bg-[var(--out-moss)] text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-[var(--out-muted)]">
        New customer?{' '}
        <Link
          href={`/outdoor/register?next=${encodeURIComponent(nextPath)}`}
          className="font-semibold text-[var(--out-moss)]"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-3 text-sm">
        <Link href="/outdoor/shop" className="text-[var(--out-muted)] hover:text-[var(--out-moss)]">
          Keep shopping
        </Link>
      </p>
    </div>
  )
}
