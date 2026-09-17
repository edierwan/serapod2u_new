'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import OutdoorBrandMark from '@/components/outdoor/OutdoorBrandMark'

function safeOutdoorNext(raw: string | null) {
  if (!raw) return '/outdoor/account'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/api/')) return '/outdoor/account'
  if (raw.startsWith('/outdoor')) return raw
  return '/outdoor/account'
}

export default function OutdoorRegisterClient() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [nextPath, setNextPath] = useState('/outdoor/account')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = safeOutdoorNext(params.get('next') || params.get('redirect'))
    setNextPath(next)

    const check = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) window.location.href = next
    }
    void check()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const supabase = createClient()
      const { data, error: signError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      })
      if (signError) throw new Error(signError.message)

      if (!data.session) {
        setInfo('Check your email to confirm your account, then sign in.')
        setLoading(false)
        return
      }

      const res = await fetch(`/api/auth/post-login-redirect?next=${encodeURIComponent(nextPath)}`)
      const payload = await res.json().catch(() => null)
      window.location.href = payload?.redirectTo || nextPath
    } catch (err: any) {
      setError(err.message || 'Could not create account')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <div className="out-card px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/outdoor" className="inline-flex">
          <OutdoorBrandMark className="h-7 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-3xl tracking-tight text-[var(--out-bark)]">Create account</h1>
        <p className="mt-2 text-sm text-[var(--out-muted)]">
          Save your details for faster Outdoor checkout.
        </p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-[var(--out-bark)]">
            Full name
            <input
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="out-input"
            />
          </label>
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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="out-input"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {info ? <p className="text-sm text-[var(--out-moss-deep)]">{info}</p> : null}
          <button type="submit" disabled={loading} className="out-btn w-full">
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--out-muted)]">
          Already have an account?{' '}
          <Link
            href={`/outdoor/login?next=${encodeURIComponent(nextPath)}`}
            className="font-semibold text-[var(--out-moss)]"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
