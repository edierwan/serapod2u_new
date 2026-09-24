'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import OutdoorBrandMark from '@/components/outdoor/OutdoorBrandMark'
import OutdoorPasswordField from '@/components/outdoor/OutdoorPasswordField'
import OutdoorSocialAuth from '@/components/outdoor/OutdoorSocialAuth'
import { outdoorPasswordIssue } from '@/lib/outdoor/password-rule'
import { resolveOutdoorReturnPath } from '@/lib/outdoor/auth-return'

export default function OutdoorRegisterClient() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState('/outdoor')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = resolveOutdoorReturnPath(params.get('next'), params.get('redirect'))
    setNextPath(next)

    const check = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) window.location.href = next
      } catch {
        // Broken/stale session should not block Google or Facebook.
      }
    }
    void check()
  }, [])

  const sendCode = async () => {
    const passwordIssue = outdoorPasswordIssue(password)
    if (passwordIssue) {
      setError(passwordIssue)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/register/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not send the code')
      setStep('code')
    } catch (err: any) {
      setError(err.message || 'Could not send the code')
    } finally {
      setLoading(false)
    }
  }

  const createAccount = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          fullName: fullName.trim(),
          password,
          code,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not create account')

      const supabase = createClient()
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signError) throw new Error('Account created. Sign in with your email and password.')

      const redirect = await fetch(`/api/auth/post-login-redirect?next=${encodeURIComponent(nextPath)}`)
      const payload = await redirect.json().catch(() => null)
      window.location.href = payload?.redirectTo || nextPath
    } catch (err: any) {
      setError(err.message || 'Could not create account')
      setLoading(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 'details') await sendCode()
    else await createAccount()
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <div className="out-card px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/outdoor" className="inline-flex">
          <OutdoorBrandMark className="h-7 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-3xl tracking-tight text-[var(--out-bark)]">Create account</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--out-muted)]">
          {step === 'code'
            ? `Enter the 4-digit code sent to ${email.trim()}.`
            : 'We email a 4-digit code before the account is created.'}
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
            Full name
            <input
              required
              autoComplete="name"
              value={fullName}
              disabled={step === 'code' || loading}
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
              disabled={step === 'code' || loading}
              onChange={(e) => setEmail(e.target.value)}
              className="out-input"
            />
          </label>
          <OutdoorPasswordField
            label="Password"
            autoComplete="new-password"
            value={password}
            disabled={step === 'code' || loading}
            onChange={setPassword}
          />
          {step === 'details' ? (
            <p className="-mt-2 text-xs leading-relaxed text-[var(--out-muted)]">
              At least 8 characters, with a capital letter, a small letter, and a number.
            </p>
          ) : null}
          {step === 'code' ? (
            <label className="block text-sm font-medium text-[var(--out-bark)]">
              Code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="out-input tracking-[0.3em]"
              />
            </label>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={loading} className="out-btn w-full">
            {loading ? 'Please wait…' : step === 'code' ? 'Create account' : 'Send code'}
          </button>
          {step === 'code' ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void sendCode()}
              className="w-full text-sm font-semibold text-[var(--out-moss)] disabled:opacity-50"
            >
              Resend code
            </button>
          ) : null}
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
