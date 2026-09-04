'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoginProductStage3D from '@/components/auth/LoginProductStage3D'

type Step = 'identifier' | 'verify' | 'new-password' | 'success'
type ResetChannel = 'email' | 'sms'

const WORDMARK_SRC = '/brand/serapod-wordmark.png'
const WORDMARK_LIGHT_SRC = '/brand/serapod-wordmark-light.png'

function detectResetChannel(raw: string): ResetChannel | null {
    const value = raw.trim()
    if (!value) return null
    if (value.includes('@')) return 'email'
    if (value.replace(/\D/g, '').length >= 8) return 'sms'
    return null
}

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

export default function ForgotPasswordPageClient({
    branding,
}: {
    branding: { copyrightText: string }
}) {
    const searchParams = useSearchParams()
    const [step, setStep] = useState<Step>('identifier')
    const [identifier, setIdentifier] = useState('')
    const [code, setCode] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
    const [resetToken, setResetToken] = useState('')
    const [resendCooldown, setResendCooldown] = useState(0)
    const [channel, setChannel] = useState<ResetChannel | null>(null)

    const detectedChannel = detectResetChannel(identifier)
    const activeChannel = channel || detectedChannel
    const payload = { identifier: identifier.trim(), mode: 'portal' as const }

    useEffect(() => {
        const prefill = searchParams.get('identifier') || searchParams.get('email') || ''
        if (prefill.trim()) setIdentifier(prefill.trim())
    }, [searchParams])

    useEffect(() => {
        if (resendCooldown <= 0) return
        const timer = setInterval(() => {
            setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
        }, 1000)
        return () => clearInterval(timer)
    }, [resendCooldown])

    const handleRequest = async () => {
        if (!identifier.trim()) {
            setError('Please enter your email or phone number.')
            return
        }
        setLoading(true)
        setError('')
        try {
            const res = await fetch('/api/auth/password-reset/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                setError(data?.error || 'Unable to send a reset code. Ask your administrator to register and verify your email or phone, then try again.')
                return
            }
            setChannel(data?.channel === 'sms' ? 'sms' : 'email')
            setResendCooldown(data?.resendCooldown || 60)
            setStep('verify')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }

    const handleVerify = async () => {
        if (!/^\d{4}$/.test(code)) {
            setError('Please enter the 4-digit verification code.')
            return
        }
        setLoading(true)
        setError('')
        try {
            const res = await fetch('/api/auth/password-reset/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, code }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                setError(data?.error || 'Verification failed.')
                if (data?.attemptsRemaining !== undefined) setAttemptsRemaining(data.attemptsRemaining)
                return
            }
            setResetToken(data.resetToken)
            setStep('new-password')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }

    const handleResend = async () => {
        if (resendCooldown > 0) return
        setLoading(true)
        setError('')
        try {
            const res = await fetch('/api/auth/password-reset/resend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                setError(data?.error || 'Unable to resend. Please try again.')
                return
            }
            if (data?.channel === 'sms' || data?.channel === 'email') {
                setChannel(data.channel)
            }
            setResendCooldown(data?.resendCooldown || 60)
            setCode('')
            setAttemptsRemaining(null)
        } catch {
            setError('Unable to resend. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleSetPassword = async () => {
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters.')
            return
        }
        if (newPassword !== confirmPassword) {
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
                    ...payload,
                    resetToken,
                    newPassword,
                    confirmPassword,
                }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                setError(data?.error || 'Failed to update password.')
                return
            }
            setStep('success')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }

    const sendButtonLabel = detectedChannel === 'email'
        ? 'Send email code'
        : detectedChannel === 'sms'
            ? 'Send SMS code'
            : 'Send verification code'
    const sendingLabel = detectedChannel === 'email'
        ? 'Sending email...'
        : detectedChannel === 'sms'
            ? 'Sending SMS...'
            : 'Sending...'

    const titles: Record<Step, string> = {
        identifier: 'Forgot Password',
        verify: activeChannel === 'email' ? 'Enter email code' : 'Enter SMS code',
        'new-password': 'Set new password',
        success: 'Password updated',
    }
    const descriptions: Record<Step, string> = {
        identifier: 'Enter the email or phone registered on your account. We send a 4-digit code to that same contact.',
        verify: activeChannel === 'email'
            ? 'We sent a 4-digit verification code to this email address.'
            : 'We sent a 4-digit verification code by SMS to this phone number.',
        'new-password': 'Create a new password for your account.',
        success: 'You can now log in with your new password.',
    }

    return (
        <div className="min-h-screen flex bg-[var(--sera-paper)] text-[var(--sera-ink)]">
            <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden text-white">
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(ellipse 80% 60% at 20% 80%, rgba(232,93,4,0.28), transparent 55%), radial-gradient(ellipse 70% 50% at 85% 15%, rgba(255,255,255,0.08), transparent 50%), linear-gradient(145deg, #141210 0%, #1f1b17 45%, #2a2018 100%)',
                    }}
                />
                <div className="relative z-10 flex h-full w-full flex-col p-10 xl:p-14">
                    <div className="login-rise shrink-0">
                        <BrandWordmark src={WORDMARK_LIGHT_SRC} className="h-11 xl:h-14 w-auto" priority />
                    </div>
                    <div className="flex-1 flex items-center min-h-0 py-4">
                        <div className="w-full flex flex-col xl:flex-row xl:items-center xl:justify-between gap-8 xl:gap-6">
                            <div className="max-w-[340px] xl:max-w-md shrink-0">
                                <div className="h-1.5 w-16 rounded-sm bg-[var(--sera-orange)] mb-7 login-accent-bar login-rise login-rise-delay-1" />
                                <h2 className="font-display text-5xl xl:text-6xl font-semibold tracking-tight leading-[1.05] login-rise login-rise-delay-2">
                                    Reset.<br />Verify.<br />Continue.
                                </h2>
                                <p className="mt-6 text-lg xl:text-xl text-white/75 leading-relaxed login-rise login-rise-delay-3">
                                    Enter your registered email or phone. We send the code there — then you set a new password.
                                </p>
                            </div>
                            <div className="login-rise login-rise-delay-2 flex justify-center xl:justify-end flex-1 min-h-0">
                                <LoginProductStage3D />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-h-screen bg-[var(--sera-paper)] relative">
                <div className="relative flex items-center justify-between px-6 sm:px-10 py-5">
                    <Link href="/login" className="flex items-center gap-3 group">
                        <BrandWordmark src={WORDMARK_SRC} className="h-8 sm:h-9 w-auto max-w-[160px] object-contain object-left" priority />
                    </Link>
                    <Link href="/login" className="text-sm text-[var(--sera-muted)] hover:text-[var(--sera-ink)] transition-colors">
                        Back to login
                    </Link>
                </div>

                <div className="relative flex-1 flex items-center justify-center px-6 sm:px-10 py-8">
                    <div className="w-full max-w-[420px]">
                        <div className="lg:hidden mb-10 login-rise">
                            <BrandWordmark src={WORDMARK_SRC} className="h-10 w-auto" priority />
                            <div className="mt-4 h-1 w-12 rounded-sm bg-[var(--sera-orange)] login-accent-bar" />
                        </div>

                        <div className="login-rise login-rise-delay-1">
                            {step === 'success' ? (
                                <CheckCircle2 className="h-10 w-10 text-emerald-600 mb-4" />
                            ) : null}
                            <h1 className="font-display text-3xl sm:text-[2.1rem] font-semibold tracking-tight text-[var(--sera-ink)]">
                                {titles[step]}
                            </h1>
                            <p className="mt-2 text-sm sm:text-[15px] text-[var(--sera-muted)] leading-relaxed">
                                {descriptions[step]}
                            </p>
                        </div>

                        {error && (
                            <div className="mt-6 bg-red-50 border border-red-200/80 rounded-lg p-3.5 flex items-start gap-2.5">
                                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-red-700 leading-snug">{error}</p>
                            </div>
                        )}

                        {step === 'identifier' && (
                            <form
                                className="mt-8 space-y-5"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    void handleRequest()
                                }}
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="identifier" className="text-[13px] font-medium text-[var(--sera-ink-soft)]">
                                        Phone number / Email
                                    </Label>
                                    <Input
                                        id="identifier"
                                        type="text"
                                        placeholder="Enter your email or phone number"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        disabled={loading}
                                        className="h-12 rounded-lg border-[var(--sera-line)] bg-white px-3.5"
                                    />
                                    <p className="text-xs text-[var(--sera-muted)] leading-relaxed">
                                        Email gets an email code. Phone gets an SMS code. If this contact is not registered, ask your administrator to add and verify it first.
                                    </p>
                                </div>
                                <Button
                                    type="submit"
                                    className="w-full h-12 rounded-lg bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white font-semibold"
                                    disabled={loading}
                                >
                                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{sendingLabel}</> : sendButtonLabel}
                                </Button>
                            </form>
                        )}

                        {step === 'verify' && (
                            <form
                                className="mt-8 space-y-5"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    void handleVerify()
                                }}
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="code" className="text-[13px] font-medium text-[var(--sera-ink-soft)]">
                                        {activeChannel === 'email' ? '4-digit email code' : '4-digit SMS code'}
                                    </Label>
                                    <Input
                                        id="code"
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={4}
                                        placeholder="0000"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                        disabled={loading}
                                        className="h-12 rounded-lg border-[var(--sera-line)] bg-white px-3.5 text-center text-2xl tracking-[0.4em] font-mono"
                                    />
                                    {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                                        <p className="text-xs text-amber-600">{attemptsRemaining} attempts remaining</p>
                                    )}
                                </div>
                                <Button
                                    type="submit"
                                    className="w-full h-12 rounded-lg bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white font-semibold"
                                    disabled={loading}
                                >
                                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying...</> : 'Verify code'}
                                </Button>
                                <button
                                    type="button"
                                    onClick={() => void handleResend()}
                                    disabled={resendCooldown > 0 || loading}
                                    className="w-full text-sm font-medium text-[var(--sera-orange)] hover:underline disabled:opacity-40 disabled:no-underline"
                                >
                                    {resendCooldown > 0
                                        ? `Resend ${activeChannel === 'email' ? 'email' : 'SMS'} in ${resendCooldown}s`
                                        : `Resend ${activeChannel === 'email' ? 'email' : 'SMS'} code`}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('identifier')
                                        setCode('')
                                        setError('')
                                        setChannel(null)
                                        setAttemptsRemaining(null)
                                    }}
                                    className="w-full text-sm text-[var(--sera-muted)] hover:text-[var(--sera-ink)]"
                                >
                                    Use a different email or phone
                                </button>
                            </form>
                        )}

                        {step === 'new-password' && (
                            <form
                                className="mt-8 space-y-5"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    void handleSetPassword()
                                }}
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="new-password">New password</Label>
                                    <div className="relative">
                                        <Input
                                            id="new-password"
                                            type={showNewPassword ? 'text' : 'password'}
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            disabled={loading}
                                            className="h-12 pr-11 rounded-lg"
                                        />
                                        <button
                                            type="button"
                                            className="absolute inset-y-0 right-0 pr-3.5 text-gray-400"
                                            onClick={() => setShowNewPassword((value) => !value)}
                                        >
                                            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirm password</Label>
                                    <div className="relative">
                                        <Input
                                            id="confirm-password"
                                            type={showConfirmPassword ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            disabled={loading}
                                            className="h-12 pr-11 rounded-lg"
                                        />
                                        <button
                                            type="button"
                                            className="absolute inset-y-0 right-0 pr-3.5 text-gray-400"
                                            onClick={() => setShowConfirmPassword((value) => !value)}
                                        >
                                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                                <Button
                                    type="submit"
                                    className="w-full h-12 rounded-lg bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white font-semibold"
                                    disabled={loading}
                                >
                                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Update password'}
                                </Button>
                            </form>
                        )}

                        {step === 'success' && (
                            <Link
                                href="/login"
                                className="mt-8 flex h-12 items-center justify-center rounded-lg bg-[var(--sera-orange)] text-white font-semibold hover:bg-[var(--sera-orange-deep)]"
                            >
                                Back to login
                            </Link>
                        )}
                    </div>
                </div>

                <div className="relative px-6 sm:px-10 py-4 text-center">
                    <p className="text-[11px] tracking-wide text-[var(--sera-muted)]">{branding.copyrightText}</p>
                </div>
            </div>
        </div>
    )
}
