'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#1877F2" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export default function OutdoorSocialAuth({
  nextPath,
  disabled,
  onError,
}: {
  nextPath: string
  disabled?: boolean
  onError: (message: string) => void
}) {
  const [loading, setLoading] = useState<'google' | 'facebook' | null>(null)

  const continueWith = async (provider: 'google' | 'facebook') => {
    setLoading(provider)
    onError('')
    const label = provider === 'google' ? 'Google' : 'Facebook'
    try {
      const supabase = createClient()
      const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callback,
          skipBrowserRedirect: true,
          queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
        },
      })
      if (error || !data?.url) {
        onError(error?.message || `Could not continue with ${label}. Try again.`)
        setLoading(null)
        return
      }
      window.location.assign(data.url)
    } catch (err: any) {
      onError(err?.message || `Could not continue with ${label}. Try again.`)
      setLoading(null)
    }
  }

  const btnClass =
    'flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-[var(--out-bark)]/12 bg-white text-sm font-semibold text-[var(--out-bark)] transition-colors hover:border-[var(--out-bark)]/30 disabled:opacity-50'

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => void continueWith('google')}
        disabled={disabled || Boolean(loading)}
        aria-label="Continue with Google"
        className={btnClass}
      >
        {loading === 'google' ? (
          <span className="text-[var(--out-muted)]">Connecting…</span>
        ) : (
          <>
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </>
        )}
      </button>
      <button
        type="button"
        onClick={() => void continueWith('facebook')}
        disabled={disabled || Boolean(loading)}
        aria-label="Continue with Facebook"
        className={btnClass}
      >
        {loading === 'facebook' ? (
          <span className="text-[var(--out-muted)]">Connecting…</span>
        ) : (
          <>
            <FacebookIcon className="h-5 w-5" />
            Continue with Facebook
          </>
        )}
      </button>
    </div>
  )
}
