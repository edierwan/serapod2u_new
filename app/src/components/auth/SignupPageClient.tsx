'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, AlertCircle } from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'
import LoginProductStage3D from '@/components/auth/LoginProductStage3D'
import SocialAuthButtons from '@/components/auth/SocialAuthButtons'

// ── Types ─────────────────────────────────────────────────────────

interface HeroBanner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  link_text: string
}

interface SignupPageClientProps {
  branding: {
    logoUrl: string | null
    loginTitle: string
    loginSubtitle: string
    copyrightText: string
  }
  loginBanners: HeroBanner[]
}

const WORDMARK_SRC = '/brand/serapod-wordmark.png'
const WORDMARK_LIGHT_SRC = '/brand/serapod-wordmark-light.png'

function BrandWordmark({
  src,
  className,
  priority,
}: {
  src: string
  className?: string
  priority?: boolean
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="serapod"
      className={className}
      width={360}
      height={120}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : {})}
    />
  )
}

export default function SignupPageClient({ branding, loginBanners }: SignupPageClientProps) {
  const [phone, setPhone] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [nextPath, setNextPath] = useState('/store')
  const [loginHref, setLoginHref] = useState('/login')
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next') || params.get('redirect')
    const safe =
      next && next.startsWith('/') && !next.startsWith('//') ? next : '/store'
    setNextPath(safe)
    const qs = new URLSearchParams()
    qs.set('mode', 'store')
    qs.set('next', safe)
    setLoginHref(`/login?${qs.toString()}`)
  }, [])

  const bannerCount = loginBanners.length
  const autoplayRef = useRef(
    Autoplay({ delay: 5000, stopOnInteraction: false, stopOnMouseEnter: true })
  )
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: bannerCount > 1, duration: 30 },
    bannerCount > 1 ? [autoplayRef.current] : []
  )

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on('select', onSelect)
    onSelect()
    return () => { emblaApi.off('select', onSelect) }
  }, [emblaApi, onSelect])

  // Check if already logged in
  useEffect(() => {
    const check = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const params = new URLSearchParams(window.location.search)
          const next = params.get('next') || params.get('redirect')
          const safe =
            next && next.startsWith('/') && !next.startsWith('//') ? next : '/store'
          router.push(safe)
        }
      } catch { }
    }
    check()
  }, [router])

  const handlePhoneSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    try {
      const supabase = createClient()
      // Send OTP to phone
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: phone.startsWith('+') ? phone : `+60${phone.replace(/^0/, '')}`,
      })

      if (otpError) {
        setError(otpError.message)
        setIsLoading(false)
        return
      }

      setSuccess('A verification code has been sent to your phone number.')
      setIsLoading(false)
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-[var(--sera-paper)]">
      {/* Left: Brand visual plane */}
      <div className="hidden lg:flex lg:w-[54%] xl:w-[58%] relative overflow-hidden bg-[var(--sera-ink)] text-white">
        {bannerCount > 0 ? (
          <>
            <div ref={emblaRef} className="overflow-hidden absolute inset-0">
              <div className="flex h-full">
                {loginBanners.map((banner, index) => (
                  <div key={banner.id} className="relative flex-[0_0_100%] min-w-0 h-full">
                    {banner.image_url ? (
                      <Image
                        src={banner.image_url}
                        alt={banner.title || 'Banner'}
                        fill
                        className="object-cover"
                        priority={index === 0}
                        sizes="60vw"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full bg-[var(--sera-ink)]" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--sera-ink)] via-[var(--sera-ink)]/45 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
                      <BrandWordmark
                        src={WORDMARK_LIGHT_SRC}
                        className="h-10 xl:h-12 w-auto mb-6 login-rise"
                        priority={index === 0}
                      />
                      {(banner.title || banner.subtitle) && (
                        <div className="text-white max-w-lg login-rise login-rise-delay-1">
                          {banner.title && (
                            <h2 className="font-display text-3xl xl:text-4xl font-semibold leading-tight tracking-tight mb-2">
                              {banner.title}
                            </h2>
                          )}
                          {banner.subtitle && (
                            <p className="text-base text-white/75 leading-relaxed">{banner.subtitle}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {bannerCount > 1 && (
              <div className="absolute bottom-5 left-10 xl:left-14 flex items-center gap-2 z-10">
                {loginBanners.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => emblaApi?.scrollTo(i)}
                    className={`h-1.5 rounded-sm transition-all ${i === selectedIndex ? 'w-8 bg-[var(--sera-orange)]' : 'w-3 bg-white/35 hover:bg-white/55'}`}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="relative w-full h-full overflow-hidden">
            <div
              className="absolute inset-0 login-sheen"
              style={{
                backgroundImage:
                  'radial-gradient(ellipse 80% 60% at 20% 80%, rgba(232,93,4,0.28), transparent 55%), radial-gradient(ellipse 70% 50% at 85% 15%, rgba(255,255,255,0.08), transparent 50%), linear-gradient(145deg, #141210 0%, #1f1b17 45%, #2a2018 100%)',
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.14] mix-blend-soft-light"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
              }}
            />
            <div className="absolute inset-x-0 bottom-0 h-1/2 opacity-50 pointer-events-none">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 80% at 70% 80%, rgba(232,93,4,0.18), transparent 60%)',
                }}
              />
            </div>

            <div className="relative z-10 flex h-full flex-col p-10 xl:p-14">
              <div className="login-rise shrink-0">
                <BrandWordmark
                  src={WORDMARK_LIGHT_SRC}
                  className="h-11 xl:h-14 w-auto"
                  priority
                />
              </div>

              <div className="flex-1 flex items-center min-h-0 py-4">
                <div className="w-full flex flex-col xl:flex-row xl:items-center xl:justify-between gap-8 xl:gap-6">
                  <div className="max-w-[340px] xl:max-w-md shrink-0">
                    <div className="h-1.5 w-16 rounded-sm bg-[var(--sera-orange)] mb-7 login-accent-bar login-rise login-rise-delay-1" />
                    <h2 className="font-display text-5xl xl:text-6xl font-semibold tracking-tight leading-[1.05] login-rise login-rise-delay-2">
                      Create.<br />Connect.<br />Launch.
                    </h2>
                    <p className="mt-6 text-lg xl:text-xl text-white/75 leading-relaxed login-rise login-rise-delay-3">
                      Join Serapod and step into premium products, campaigns, and a supply flow built for the brand.
                    </p>
                  </div>

                  <div className="login-rise login-rise-delay-2 flex justify-center xl:justify-end flex-1 min-h-0">
                    <LoginProductStage3D />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Signup form */}
      <div className="flex-1 flex flex-col min-h-screen bg-[var(--sera-paper)] relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, transparent 0%, transparent 96%, rgba(20,18,16,0.04) 100%), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(232,93,4,0.06), transparent 60%)',
          }}
        />

        <div className="relative flex items-center justify-between px-6 sm:px-10 py-5">
          <Link href="/store" className="flex items-center gap-3 group">
            <BrandWordmark
              src={WORDMARK_SRC}
              className="h-8 sm:h-9 w-auto max-w-[160px] object-contain object-left"
              priority
            />
          </Link>
          <Link
            href="/store"
            className="text-sm text-[var(--sera-muted)] hover:text-[var(--sera-ink)] transition-colors"
          >
            Need help?
          </Link>
        </div>

        <div className="relative flex-1 flex items-center justify-center px-6 sm:px-10 py-8">
          <div className="w-full max-w-[420px]">
            <div className="lg:hidden mb-10 login-rise">
              <BrandWordmark src={WORDMARK_SRC} className="h-10 w-auto" priority />
              <div className="mt-4 h-1 w-12 rounded-sm bg-[var(--sera-orange)] login-accent-bar" />
            </div>

            <div className="login-rise login-rise-delay-1">
              <h1 className="font-display text-3xl sm:text-[2.1rem] font-semibold tracking-tight text-[var(--sera-ink)]">
                Sign Up
              </h1>
              <p className="mt-2 text-sm sm:text-[15px] text-[var(--sera-muted)] leading-relaxed">
                Create your Serapod2U account.
              </p>
            </div>

            {error && (
              <div className="mt-6 bg-red-50 border border-red-200/80 rounded-lg p-3.5 flex items-start gap-2.5 login-rise login-rise-delay-2">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 leading-snug">{error}</p>
              </div>
            )}
            {success && (
              <div className="mt-6 bg-emerald-50 border border-emerald-200/80 rounded-lg p-3.5 login-rise login-rise-delay-2">
                <p className="text-sm text-emerald-800 leading-snug">{success}</p>
              </div>
            )}

            <form onSubmit={handlePhoneSignup} className="mt-8 space-y-5 login-rise login-rise-delay-2">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-[13px] font-medium text-[var(--sera-ink-soft)]">
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="e.g. 60191234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-12 rounded-lg border-[var(--sera-line)] bg-white px-3.5 text-[var(--sera-ink)] placeholder:text-gray-400 focus-visible:ring-[var(--sera-orange)]/30 focus-visible:border-[var(--sera-orange)]"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-lg bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white font-semibold tracking-wide shadow-none transition-colors"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'NEXT'
                )}
              </Button>
            </form>

            <div className="relative my-8 login-rise login-rise-delay-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--sera-line)]" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-[0.18em]">
                <span className="bg-[var(--sera-paper)] px-3 text-[var(--sera-muted)] font-medium">OR</span>
              </div>
            </div>

            <div className="login-rise login-rise-delay-4">
              <SocialAuthButtons
                nextPath={nextPath}
                disabled={isLoading}
                onError={setError}
                variant="portal"
              />
            </div>

            <p className="mt-8 text-center text-xs text-[var(--sera-muted)] leading-relaxed login-rise login-rise-delay-4">
              By signing up, you agree to Serapod2U&apos;s{' '}
              <Link href="/terms" className="font-medium text-[var(--sera-ink)] hover:text-[var(--sera-orange)] transition-colors">
                Terms of Service
              </Link>
              {' '}&amp;{' '}
              <Link href="/privacy" className="font-medium text-[var(--sera-ink)] hover:text-[var(--sera-orange)] transition-colors">
                Privacy Policy
              </Link>
            </p>

            <div className="mt-6 text-center text-sm text-[var(--sera-muted)] login-rise login-rise-delay-4">
              Have an account?{' '}
              <Link href={loginHref} className="font-semibold text-[var(--sera-ink)] hover:text-[var(--sera-orange)] transition-colors">
                Log In
              </Link>
            </div>
          </div>
        </div>

        <div className="relative px-6 sm:px-10 py-4 text-center">
          <p className="text-[11px] tracking-wide text-[var(--sera-muted)]">{branding.copyrightText}</p>
        </div>
      </div>
    </div>
  )
}
