'use client'

import { useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { outdoorPublicOrigin, persistOutdoorReturnPath } from '@/lib/outdoor/auth-return'
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
  TikTokIcon,
  XIcon,
} from '@/components/auth/SocialProviderIcons'

export type SocialProvider = 'google' | 'facebook' | 'twitter' | 'instagram' | 'tiktok'

const LABELS: Record<SocialProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
  twitter: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
}

const NATIVE: SocialProvider[] = ['google', 'facebook']

export default function SocialAuthButtons({
  nextPath,
  disabled,
  onError,
  variant = 'outdoor',
}: {
  nextPath: string
  disabled?: boolean
  onError: (message: string) => void
  variant?: 'outdoor' | 'portal'
}) {
  const [loading, setLoading] = useState<SocialProvider | null>(null)

  const continueWith = async (provider: SocialProvider) => {
    setLoading(provider)
    onError('')
    const label = LABELS[provider]
    try {
      const returnTo =
        variant === 'outdoor'
          ? persistOutdoorReturnPath(nextPath)
          : nextPath.startsWith('/') && !nextPath.startsWith('//')
            ? nextPath
            : '/store'
      if (!NATIVE.includes(provider)) {
        const start = `/api/auth/oauth/${provider}/start?next=${encodeURIComponent(returnTo)}`
        window.location.assign(start)
        return
      }
      const supabase = createClient()
      const callback = `${outdoorPublicOrigin()}/auth/callback?next=${encodeURIComponent(returnTo)}`
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

  const outdoorBtn =
    'flex h-12 min-w-0 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--out-bark)]/12 bg-white px-2 text-sm font-semibold text-[var(--out-bark)] transition-colors hover:border-[var(--out-bark)]/30 disabled:opacity-50'
  const portalBtn =
    'flex min-w-0 items-center justify-center gap-2 h-11 px-3 rounded-lg border border-[var(--sera-line)] bg-white hover:border-[var(--sera-ink)]/30 text-sm font-medium text-[var(--sera-ink)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const btnClass = variant === 'portal' ? portalBtn : outdoorBtn

  const items: { provider: SocialProvider; icon: ReactNode }[] = [
    { provider: 'google', icon: <GoogleIcon className="h-5 w-5 shrink-0" /> },
    { provider: 'facebook', icon: <FacebookIcon className="h-5 w-5 shrink-0" /> },
    { provider: 'instagram', icon: <InstagramIcon className="h-5 w-5 shrink-0" /> },
    { provider: 'tiktok', icon: <TikTokIcon className="h-5 w-5 shrink-0" /> },
    { provider: 'twitter', icon: <XIcon className="h-5 w-5 shrink-0" /> },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {items.map(({ provider, icon }) => (
        <button
          key={provider}
          type="button"
          onClick={() => void continueWith(provider)}
          disabled={disabled || Boolean(loading)}
          aria-label={`Continue with ${LABELS[provider]}`}
          className={btnClass}
        >
          {loading === provider ? (
            <span className={variant === 'outdoor' ? 'text-[var(--out-muted)]' : ''}>Connecting…</span>
          ) : (
            <>
              {icon}
              <span className="truncate">{LABELS[provider]}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
