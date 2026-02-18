'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient, resetClient, forceCleanStorage } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, AlertCircle, Package } from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'

// ── Types ─────────────────────────────────────────────────────────

interface HeroBanner {
  id: string; title: string; subtitle: string; badge_text: string;
  image_url: string; link_url: string; link_text: string;
}

interface SignupPageClientProps {
  branding: {
    logoUrl: string | null; loginTitle: string;
    loginSubtitle: string; copyrightText: string;
  }
  loginBanners: HeroBanner[]
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

export default function SignupPageClient({ branding, loginBanners }: SignupPageClientProps) {
  const [phone, setPhone] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()

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
    emblaApi.on('select', onSelect); onSelect()
    return () => { emblaApi.off('select', onSelect) }
  }, [emblaApi, onSelect])

  // Check if already logged in
  useEffect(() => {
    const check = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) router.push('/store')
      } catch {}
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

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider)
    setError('')

    try {
      const supabase = createClient()
      const siteUrl = window.location.origin

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${siteUrl}/auth/callback?next=/store`,
          queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
        },
      })

      if (error) {
        setError(`Failed to connect with ${provider}. Please try again.`)
        setSocialLoading(null)
      }
    } catch {
      setError('An unexpected error occurred.')
      setSocialLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: Hero Banner */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-[60%] relative bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
        {bannerCount > 0 ? (
          <>
            <div ref={emblaRef} className="overflow-hidden absolute inset-0">
              <div className="flex h-full">
                {loginBanners.map((banner, index) => (
                  <div key={banner.id} className="relative flex-[0_0_100%] min-w-0 h-full">
                    {banner.image_url ? (
                      <Image src={banner.image_url} alt={banner.title || 'Banner'} fill className="object-cover" priority={index === 0} sizes="60vw" unoptimized />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                    {(banner.title || banner.subtitle) && (
                      <div className="absolute bottom-12 left-8 right-8 text-white">
                        {banner.badge_text && (
                          <span className="inline-block px-3 py-1 text-xs font-medium tracking-wider uppercase bg-blue-500/20 backdrop-blur-sm rounded-full mb-3 border border-blue-400/30">
                            {banner.badge_text}
                          </span>
                        )}
                        {banner.title && <h2 className="text-3xl xl:text-4xl font-bold leading-tight mb-2">{banner.title}</h2>}
                        {banner.subtitle && <p className="text-base text-white/80 max-w-md">{banner.subtitle}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {bannerCount > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
                {loginBanners.map((_, i) => (
                  <button key={i} onClick={() => emblaApi?.scrollTo(i)}
                    className={`h-2 rounded-full transition-all ${i === selectedIndex ? 'w-6 bg-white' : 'w-2 bg-white/40'}`}
                    aria-label={`Slide ${i + 1}`} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center w-full p-12">
            <div className="absolute inset-0 opacity-30" style={{
              background: 'radial-gradient(circle at 30% 50%, rgba(59,130,246,0.2), transparent 50%), radial-gradient(circle at 70% 50%, rgba(168,85,247,0.15), transparent 50%)',
            }} />
            <div className="relative text-center text-white max-w-lg">
              <div className="h-16 w-16 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/20">
                <Package className="h-8 w-8" />
              </div>
              <h2 className="text-4xl font-bold mb-4">Join Serapod2U</h2>
              <p className="text-lg text-white/70">Create your account and start shopping for premium products today.</p>
            </div>
          </div>
        )}
      </div>

      {/* Right: Signup Form */}
      <div className="flex-1 flex flex-col min-h-screen bg-white">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 sm:px-8 py-4 border-b border-gray-100">
          <Link href="/store" className="flex items-center gap-2">
            {branding.logoUrl ? (
              <Image src={branding.logoUrl} alt="Logo" width={32} height={32} className="rounded-lg" />
            ) : (
              <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
            )}
            <span className="text-lg font-semibold text-gray-900">Serapod2U</span>
          </Link>
          <Link href="/store" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Need help?
          </Link>
        </div>

        {/* Form */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-8 py-8">
          <div className="w-full max-w-[400px] space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sign Up</h1>
              <p className="mt-1 text-sm text-gray-500">Create your Serapod2U account.</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            )}

            <form onSubmit={handlePhoneSignup} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-sm font-medium text-gray-700">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="e.g. 60191234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  disabled={isLoading || !!socialLoading}
                  className="h-11 rounded-xl border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-blue-600/25"
                disabled={isLoading || !!socialLoading}
              >
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
                ) : (
                  'NEXT'
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-3 text-gray-400 font-medium">OR</span>
              </div>
            </div>

            {/* Social Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSocialLogin('facebook')}
                disabled={isLoading || !!socialLoading}
                aria-label="Sign up with Facebook"
                className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all disabled:opacity-50"
              >
                {socialLoading === 'facebook' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FacebookIcon className="h-5 w-5" />}
                <span>Facebook</span>
              </button>
              <button
                type="button"
                onClick={() => handleSocialLogin('google')}
                disabled={isLoading || !!socialLoading}
                aria-label="Sign up with Google"
                className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all disabled:opacity-50"
              >
                {socialLoading === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon className="h-5 w-5" />}
                <span>Google</span>
              </button>
            </div>

            {/* Terms */}
            <p className="text-center text-xs text-gray-400">
              By signing up, you agree to Serapod2U&apos;s{' '}
              <Link href="/terms" className="text-blue-600 hover:underline">Terms of Service</Link> &amp;{' '}
              <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>
            </p>

            {/* Login Link */}
            <div className="text-center text-sm text-gray-500">
              Have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-semibold">Log In</Link>
            </div>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">{branding.copyrightText}</p>
        </div>
      </div>
    </div>
  )
}
