'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient, forceCleanStorage, resetClient } from '@/lib/supabase/client'
import OutdoorBrandMark from '@/components/outdoor/OutdoorBrandMark'
import OutdoorSocialAuth from '@/components/outdoor/OutdoorSocialAuth'
import { resolveOutdoorReturnPath } from '@/lib/outdoor/auth-return'

function oauthErrorMessage(code: string | null, message: string | null) {
  if (!code) return ''
  if (message) return message
  if (code === 'oauth_failed') return 'Social sign-in was cancelled or failed. Try again.'
  if (code === 'no_code' || code === 'session_failed') return 'Could not finish social sign-in. Try again.'
  return 'Could not sign in. Try again.'
}

export default function OutdoorLoginClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState('/outdoor')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = resolveOutdoorReturnPath(params.get('next'), params.get('redirect'))
    setNextPath(next)
    setError(oauthErrorMessage(params.get('error'), params.get('message')))

    const check = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        window.location.href = next
      } catch {
        // Broken/stale session should not block Google or Facebook.
      }
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
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <div className="out-card px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/outdoor" className="inline-flex">
          <OutdoorBrandMark className="h-7 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-3xl tracking-tight text-[var(--out-bark)]">Sign in</h1>
        <p className="mt-2 text-sm text-[var(--out-muted)]">
          Use your account to checkout and follow Outdoor orders.
        </p>

        <div className="mt-6">
          <OutdoorSocialAuth nextPath={nextPath} disabled={loading} onError={setError} />
        </div>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--out-bark)]/10" />
          </div>
          <div className="relative flex justify-center text-[11px] uppercase tracking-[0.16em]">
            <span className="bg-white px-3 text-[var(--out-muted)]">or email</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-[var(--out-bark)]">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="out-input"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--out-bark)]">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="out-input"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={loading} className="out-btn w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--out-muted)]">
          New here?{' '}
          <Link
            href={`/outdoor/register?next=${encodeURIComponent(nextPath)}`}
            className="font-semibold text-[var(--out-moss)]"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
