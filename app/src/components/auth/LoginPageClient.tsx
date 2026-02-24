'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient, resetClient, forceCleanStorage } from '@/lib/supabase/client'
import { normalizePhone } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Eye, EyeOff, Loader2, AlertCircle, ChevronLeft, ChevronRight,
    Package,
} from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'
import HeroMedia from '@/components/storefront/HeroMedia'
import VectorAuroraBackground from '@/components/storefront/VectorAuroraBackground'

// ── Types ─────────────────────────────────────────────────────────

interface HeroBanner {
    id: string
    title: string
    subtitle: string
    badge_text: string
    image_url: string
    link_url: string
    link_text: string
    animation_enabled?: boolean
    animation_style?: 'none' | 'kenburns' | 'floatGlow' | 'parallax'
    animation_intensity?: 'low' | 'medium' | 'high'
}

interface LoginPageClientProps {
    branding: {
        logoUrl: string | null
        loginTitle: string
        loginSubtitle: string
        copyrightText: string
    }
    loginBanners: HeroBanner[]
}

// ── Social Icons ──────────────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    )
}

function FacebookIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#1877F2">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
    )
}

// ── Component ─────────────────────────────────────────────────────

export default function LoginPageClient({ branding, loginBanners }: LoginPageClientProps) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | null>(null)
    const [error, setError] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const router = useRouter()

    // Mode from URL: ?mode=store | ?mode=business (UI copy only)
    const [mode, setMode] = useState<'store' | 'business'>('store')
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const m = params.get('mode')
        if (m === 'business') setMode('business')
    }, [])

    /**
     * Centralized post-login redirect.
     * Calls the server API which reads account_scope and returns { redirectTo }.
     */
    const doPostLoginRedirect = async () => {
        try {
            const res = await fetch('/api/auth/post-login-redirect')
            const data = await res.json()
            router.replace(data.redirectTo || '/store')
        } catch {
            // Fallback if API is unreachable
            router.replace('/store')
        }
    }

    const bannerCount = loginBanners.length

    // Embla carousel for hero banners
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

    // Clear stale session on mount — use centralized redirect
    useEffect(() => {
        const clearStaleSession = async () => {
            try {
                const supabase = createClient()
                const { data: { user }, error } = await supabase.auth.getUser()
                if (error) {
                    forceCleanStorage()
                    await supabase.auth.signOut({ scope: 'local' })
                    resetClient()
                } else if (user) {
                    // User is already logged in — redirect via centralized API
                    doPostLoginRedirect()
                }
            } catch {
                forceCleanStorage()
            }
        }
        clearStaleSession()
    }, [router])

    // ── Email/Password Login ────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError('')

        try {
            forceCleanStorage()
            resetClient()
            const supabase = createClient()

            let credentials: any = { password }

            if (email.includes('@')) {
                credentials.email = email
            } else {
                const normalizedPhone = normalizePhone(email)
                const { data: userEmail, error: lookupError } = await supabase
                    .rpc('get_email_by_phone' as any, { p_phone: normalizedPhone } as any)

                if (lookupError || !userEmail) {
                    setError('Phone number not found. Please check your number or use email.')
                    setIsLoading(false)
                    return
                }
                credentials.email = userEmail
            }

            const { error: signInError } = await supabase.auth.signInWithPassword(credentials)

            if (signInError) {
                if (signInError.message.includes('Invalid login credentials')) {
                    setError('Invalid email or password. Please check your credentials.')
                } else if (signInError.status === 429) {
                    setError('Too many attempts. Please wait a few minutes.')
                } else {
                    setError(signInError.message)
                }
                setIsLoading(false)
                return
            }

            const { data: { user: authUser } } = await supabase.auth.getUser()
            if (!authUser) {
                setError('Authentication failed. Please try again.')
                setIsLoading(false)
                return
            }

            // Update last_login_at
            try {
                await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', authUser.id)
            } catch { }

            // Get user profile to determine redirect
            let { data: userProfile } = await supabase
                .from('users')
                .select('*, organizations!fk_users_organization(org_type_code)')
                .eq('id', authUser.id)
                .single()

            if (!userProfile) {
                await new Promise(resolve => setTimeout(resolve, 500))
                const { data: retryProfile } = await supabase
                    .from('users')
                    .select('*, organizations!fk_users_organization(org_type_code)')
                    .eq('id', authUser.id)
                    .single()
                userProfile = retryProfile
            }

            if (!userProfile || !userProfile.is_active) {
                await supabase.auth.signOut()
                setError('Your account is inactive. Contact your administrator.')
                setIsLoading(false)
                return
            }

            // Update last_login via RPC
            try {
                await supabase.rpc('update_last_login', { user_id: authUser.id } as any)
            } catch { }

            // Capture IP (fire and forget)
            fetch('/api/update-login-ip', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => { })

            await new Promise(resolve => setTimeout(resolve, 500))
            router.refresh()

            // Route via centralized post-login redirect API
            await doPostLoginRedirect()
        } catch (err) {
            console.error('Login error:', err)
            setError('An unexpected error occurred. Please try again.')
            setIsLoading(false)
        } finally {
            setIsLoading(false)
        }
    }

    // ── Social Login ────────────────────────────────────────────────
    const handleSocialLogin = async (provider: 'google' | 'facebook') => {
        setSocialLoading(provider)
        setError('')

        try {
            const supabase = createClient()
            const siteUrl = window.location.origin

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: `${siteUrl}/auth/callback`,
                    queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
                },
            })

            if (error) {
                setError(`Failed to connect with ${provider}. Please try again.`)
                setSocialLoading(null)
            }
            // If successful, browser will redirect to provider
        } catch (err) {
            setError('An unexpected error occurred. Please try again.')
            setSocialLoading(null)
        }
    }

    // ── Render ──────────────────────────────────────────────────────

    return (
        <div className="min-h-screen flex">
            {/* Left: Hero Banner Section */}
            <div className="hidden lg:flex lg:w-[55%] xl:w-[60%] relative bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
                {bannerCount > 0 ? (
                    <>
                        <div ref={emblaRef} className="overflow-hidden absolute inset-0">
                            <div className="flex h-full">
                                {loginBanners.map((banner, index) => (
                                    <div key={banner.id} className="relative flex-[0_0_100%] min-w-0 h-full">
                                        <HeroMedia
                                            imageUrl={banner.image_url}
                                            alt={banner.title || 'Banner'}
                                            animationEnabled={banner.animation_enabled}
                                            animationStyle={banner.animation_style || 'none'}
                                            intensity={banner.animation_intensity || 'low'}
                                            context="login"
                                            priority={index === 0}
                                        />
                                        {(banner.title || banner.subtitle) && (
                                            <div className="absolute bottom-12 left-8 right-8 text-white">
                                                {banner.badge_text && (
                                                    <span className="inline-block px-3 py-1 text-xs font-medium tracking-wider uppercase bg-blue-500/20 backdrop-blur-sm rounded-full mb-3 border border-blue-400/30">
                                                        {banner.badge_text}
                                                    </span>
                                                )}
                                                {banner.title && (
                                                    <h2 className="text-3xl xl:text-4xl font-bold leading-tight mb-2">{banner.title}</h2>
                                                )}
                                                {banner.subtitle && (
                                                    <p className="text-base text-white/80 max-w-md">{banner.subtitle}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Dots indicator */}
                        {bannerCount > 1 && (
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
                                {loginBanners.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => emblaApi?.scrollTo(i)}
                                        className={`h-2 rounded-full transition-all ${i === selectedIndex ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/60'
                                            }`}
                                        aria-label={`Go to slide ${i + 1}`}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    /* Default hero — SVG vector aurora when no login banners configured */
                    <div className="relative w-full h-full overflow-hidden">
                        <VectorAuroraBackground intensity="medium" animate={true} />

                        {/* Gradient overlay for depth */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 z-[2]" />

                        {/* Content */}
                        <div className="relative flex items-center justify-center w-full h-full p-12 z-10">
                            <div className="text-center text-white max-w-lg">
                                {/* Logo badge */}
                                <div className="h-16 w-16 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/20 shadow-lg shadow-blue-500/10">
                                    <Package className="h-8 w-8 text-white" />
                                </div>
                                <h2 className="text-4xl font-bold mb-4 bg-gradient-to-r from-white via-blue-200 to-white bg-clip-text text-transparent">Serapod2U</h2>
                                <p className="text-lg text-white/70 leading-relaxed">
                                    Your one-stop platform for premium products, seamless supply chain management, and exceptional shopping experience.
                                </p>
                                <div className="mt-8 flex items-center justify-center gap-8">
                                    <div className="text-center">
                                        <div className="text-2xl font-bold" style={{ textShadow: '0 0 20px rgba(99,102,241,0.3)' }}>500+</div>
                                        <div className="text-sm text-white/60">Products</div>
                                    </div>
                                    <div className="w-px h-10 bg-white/20" />
                                    <div className="text-center">
                                        <div className="text-2xl font-bold" style={{ textShadow: '0 0 20px rgba(99,102,241,0.3)' }}>24/7</div>
                                        <div className="text-sm text-white/60">Support</div>
                                    </div>
                                    <div className="w-px h-10 bg-white/20" />
                                    <div className="text-center">
                                        <div className="text-2xl font-bold" style={{ textShadow: '0 0 20px rgba(99,102,241,0.3)' }}>100%</div>
                                        <div className="text-sm text-white/60">Authentic</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Login Form Section */}
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
                    <Link
                        href="/store"
                        className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        Need help?
                    </Link>
                </div>

                {/* Login Form */}
                <div className="flex-1 flex items-center justify-center px-6 sm:px-8 py-8">
                    <div className="w-full max-w-[400px] space-y-6">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">
                                {mode === 'business' ? 'Business Portal Login' : 'Log In'}
                            </h1>
                            <p className="mt-1 text-sm text-gray-500">
                                {mode === 'business'
                                    ? 'Sign in to access your Serapod business dashboard.'
                                    : 'Welcome back! Sign in to continue.'}
                            </p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}

                        {/* Login Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                                    Phone number / Email
                                </Label>
                                <Input
                                    id="email"
                                    type="text"
                                    placeholder="Enter your email or phone number"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={isLoading || !!socialLoading}
                                    className="h-11 rounded-xl border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                                    Password
                                </Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="Enter your password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        disabled={isLoading || !!socialLoading}
                                        className="h-11 pr-10 rounded-xl border-gray-200 focus:border-blue-500 focus:ring-blue-500/20"
                                    />
                                    <button
                                        type="button"
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                        onClick={() => setShowPassword(!showPassword)}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-blue-600/25 transition-all"
                                disabled={isLoading || !!socialLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Signing in...
                                    </>
                                ) : (
                                    'LOG IN'
                                )}
                            </Button>
                        </form>

                        <div className="text-left">
                            <Link href="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                                Forgot Password
                            </Link>
                        </div>

                        {/* Divider */}
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-200" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-3 text-gray-400 font-medium">OR</span>
                            </div>
                        </div>

                        {/* Social Login Buttons */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => handleSocialLogin('facebook')}
                                disabled={isLoading || !!socialLoading}
                                aria-label="Continue with Facebook"
                                className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {socialLoading === 'facebook' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <FacebookIcon className="h-5 w-5" />
                                )}
                                <span>Facebook</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleSocialLogin('google')}
                                disabled={isLoading || !!socialLoading}
                                aria-label="Continue with Google"
                                className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {socialLoading === 'google' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <GoogleIcon className="h-5 w-5" />
                                )}
                                <span>Google</span>
                            </button>
                        </div>

                        {/* Sign Up Link */}
                        <div className="text-center text-sm text-gray-500 pt-2">
                            New to Serapod2U?{' '}
                            <Link href="/signup" className="text-blue-600 hover:text-blue-700 font-semibold">
                                Sign Up
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 sm:px-8 py-4 border-t border-gray-100 text-center">
                    <p className="text-xs text-gray-400">{branding.copyrightText}</p>
                </div>
            </div>
        </div>
    )
}
