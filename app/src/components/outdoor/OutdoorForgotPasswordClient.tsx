'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import OutdoorBrandMark from '@/components/outdoor/OutdoorBrandMark'
import OutdoorPasswordField from '@/components/outdoor/OutdoorPasswordField'
import { outdoorPasswordIssue } from '@/lib/outdoor/password-rule'
import { resolveOutdoorReturnPath } from '@/lib/outdoor/auth-return'

type Step = 'email' | 'code' | 'password' | 'done'

function resetError(data: { error?: string; code?: string } | null, fallback: string) {
  if (data?.code === 'not_registered') {
    return 'No account uses this email. Create an account, or sign in with Google or X.'
  }
  if (data?.code === 'rate_limited') {
    return 'Too many codes for this email. Wait 15 minutes, then try again.'
  }
  return data?.error || fallback
}

export default function OutdoorForgotPasswordClient() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [nextPath, setNextPath] = useState('/outdoor')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNextPath(resolveOutdoorReturnPath(params.get('next'), params.get('redirect')))
    const prefill = params.get('email')
    if (prefill?.includes('@')) setEmail(prefill.trim())
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((value) => (value > 0 ? value - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const loginHref = `/outdoor/login?next=${encodeURIComponent(nextPath)}${email.trim() ? `&email=${encodeURIComponent(email.trim())}` : ''}`

  const sendCode = async (resend = false) => {
    if (!email.includes('@')) {
      setError('A valid email is required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/outdoor/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), resend }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(resetError(data, 'Could not send the code.'))
        return
      }
      setCooldown(Number(data?.resendCooldown) || 60)
      setCode('')
      setStep('code')
    } catch {
      setError('Could not send the code.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit code from the email.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/password-reset/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email.trim(), code, delivery: 'email', mode: 'portal' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.resetToken) {
        setError(resetError(data, 'That code is not valid.'))
        return
      }
      setResetToken(data.resetToken)
      setStep('password')
    } catch {
      setError('Could not check the code.')
    } finally {
      setLoading(false)
    }
  }

  const savePassword = async () => {
    const passwordIssue = outdoorPasswordIssue(password)
    if (passwordIssue) {
      setError(passwordIssue)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: email.trim(),
          resetToken,
          newPassword: password,
          confirmPassword: confirm,
          delivery: 'email',
          mode: 'portal',
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(resetError(data, 'Could not update the password.'))
        return
      }
      setStep('done')
    } catch {
      setError('Could not update the password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
      <div className="out-card px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/outdoor" className="inline-flex">
          <OutdoorBrandMark className="h-7 w-auto" />
        </Link>
        <h1 className="mt-6 font-display text-3xl tracking-tight text-[var(--out-bark)]">Forgot password</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--out-muted)]">
          {step === 'done'
            ? 'Your password is updated. Sign in with the new one.'
            : 'Enter the email on your account. We send a 4-digit code.'}
        </p>

        {step === 'email' ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void sendCode(false)
            }}
          >
            <label className="block text-sm font-medium text-[var(--out-bark)]">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="out-input"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="submit" disabled={loading} className="out-btn w-full">
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void verifyCode()
            }}
          >
            <label className="block text-sm font-medium text-[var(--out-bark)]">
              Code sent to {email}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                className="out-input tracking-[0.3em]"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="submit" disabled={loading} className="out-btn w-full">
              {loading ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              disabled={loading || cooldown > 0}
              onClick={() => void sendCode(true)}
              className="w-full text-sm font-semibold text-[var(--out-moss)] disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </form>
        ) : null}

        {step === 'password' ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void savePassword()
            }}
          >
            <OutdoorPasswordField
              label="New password"
              autoComplete="new-password"
              value={password}
              disabled={loading}
              onChange={setPassword}
            />
            <p className="-mt-2 text-xs leading-relaxed text-[var(--out-muted)]">
              At least 8 characters, with a capital letter, a small letter, and a number.
            </p>
            <OutdoorPasswordField
              label="Confirm password"
              autoComplete="new-password"
              value={confirm}
              disabled={loading}
              onChange={setConfirm}
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="submit" disabled={loading} className="out-btn w-full">
              {loading ? 'Saving…' : 'Update password'}
            </button>
          </form>
        ) : null}

        {step === 'done' ? (
          <Link href={loginHref} className="out-btn mt-6 w-full no-underline">
            Back to sign in
          </Link>
        ) : (
          <p className="mt-6 text-sm text-[var(--out-muted)]">
            <Link href={loginHref} className="font-semibold text-[var(--out-moss)]">
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
