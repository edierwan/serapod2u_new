'use client'

/**
 * ForgotPasswordModal — multi-step email OTP password reset flow
 * Used from Collect Points / loyalty login on /track/product/...
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Mail, ShieldCheck, Lock, CheckCircle2, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { isValidEmail, maskEmail, normalizeEmail } from '@/lib/auth/password-reset-otp-email'

type Step = 'email' | 'verify' | 'new-password' | 'success'

interface ForgotPasswordModalProps {
    isOpen: boolean
    onClose: () => void
    onBackToLogin: () => void
    primaryColor: string
    buttonColor: string
    /** Prefill from Collect Points login field when available */
    initialEmail?: string
}

export default function ForgotPasswordModal({
    isOpen,
    onClose,
    onBackToLogin,
    primaryColor,
    buttonColor,
    initialEmail = '',
}: ForgotPasswordModalProps) {
    const [step, setStep] = useState<Step>('email')
    const [email, setEmail] = useState('')
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

    useEffect(() => {
        if (!isOpen) {
            setStep('email')
            setEmail('')
            setCode('')
            setNewPassword('')
            setConfirmPassword('')
            setShowNewPassword(false)
            setShowConfirmPassword(false)
            setLoading(false)
            setError('')
            setAttemptsRemaining(null)
            setResetToken('')
            setResendCooldown(0)
            return
        }
        const prefill = String(initialEmail || '').trim()
        if (prefill.includes('@')) setEmail(normalizeEmail(prefill))
    }, [isOpen, initialEmail])

    useEffect(() => {
        if (resendCooldown <= 0) return
        const timer = setInterval(() => {
            setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
        }, 1000)
        return () => clearInterval(timer)
    }, [resendCooldown])

    const handleRequestOtp = useCallback(async () => {
        if (!isValidEmail(email)) {
            setError('Please enter a valid email address.')
            return
        }

        setLoading(true)
        setError('')

        try {
            const res = await fetch('/api/auth/password-reset/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizeEmail(email) }),
            })

            let data: any
            try {
                data = await res.json()
            } catch {
                setError('Server error. Please try again later.')
                return
            }

            if (!res.ok && data.error) {
                setError(data.error)
                return
            }

            setResendCooldown(data.resendCooldown || 60)
            setStep('verify')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }, [email])

    const handleVerifyOtp = useCallback(async () => {
        if (!/^\d{4}$/.test(code)) {
            setError('Please enter the 4-digit code.')
            return
        }

        setLoading(true)
        setError('')

        try {
            const res = await fetch('/api/auth/password-reset/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizeEmail(email), code }),
            })

            let data: any
            try {
                data = await res.json()
            } catch {
                setError('Server error. Please try again later.')
                return
            }

            if (!res.ok) {
                setError(data.error || 'Verification failed.')
                if (data.attemptsRemaining !== undefined) {
                    setAttemptsRemaining(data.attemptsRemaining)
                }
                return
            }

            setResetToken(data.resetToken)
            setStep('new-password')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }, [email, code])

    const handleResend = useCallback(async () => {
        if (resendCooldown > 0) return

        setLoading(true)
        setError('')

        try {
            const res = await fetch('/api/auth/password-reset/resend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizeEmail(email) }),
            })

            let data: any
            try {
                data = await res.json()
            } catch {
                setError('Server error. Please try again later.')
                return
            }

            if (!res.ok && data.error) {
                setError(data.error)
                return
            }

            setResendCooldown(data.resendCooldown || 60)
            setCode('')
            setAttemptsRemaining(null)
            setError('')
        } catch {
            setError('Unable to resend. Please try again.')
        } finally {
            setLoading(false)
        }
    }, [email, resendCooldown])

    const handleSetPassword = useCallback(async () => {
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
                    email: normalizeEmail(email),
                    resetToken,
                    newPassword,
                    confirmPassword,
                }),
            })

            let data: any
            try {
                data = await res.json()
            } catch {
                setError('Server error. Please try again later.')
                return
            }

            if (!res.ok) {
                setError(data.error || 'Failed to update password.')
                return
            }

            setStep('success')
        } catch {
            setError('Unable to connect. Please check your internet connection.')
        } finally {
            setLoading(false)
        }
    }, [email, resetToken, newPassword, confirmPassword])

    if (!isOpen) return null

    const StepIcon = {
        email: Mail,
        verify: ShieldCheck,
        'new-password': Lock,
        success: CheckCircle2,
    }[step]

    const stepTitle = {
        email: 'Forgot Password',
        verify: 'Verify Code',
        'new-password': 'Set New Password',
        success: 'Password Updated',
    }[step]

    const stepDescription = {
        email: 'Enter your email address to receive a reset code.',
        verify: `If an account exists for ${maskEmail(email)}, a 4-digit code will arrive shortly.`,
        'new-password': 'Create a new password for your account.',
        success: 'Password updated successfully. Please log in to continue.',
    }[step]

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
                <div className="text-center">
                    <div
                        className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                        style={{ backgroundColor: `${primaryColor}15` }}
                    >
                        <StepIcon className="w-8 h-8" style={{ color: primaryColor }} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">{stepTitle}</h3>
                    <p className="text-sm text-gray-500 mt-1">{stepDescription}</p>
                </div>

                {step === 'email' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="e.g. name@example.com"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                                style={{ '--tw-ring-color': primaryColor } as any}
                                disabled={loading}
                                autoFocus
                                autoComplete="email"
                            />
                        </div>
                    </div>
                )}

                {step === 'verify' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                4-Digit Code
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={4}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                placeholder="0000"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 text-center text-2xl tracking-[0.5em] font-mono"
                                style={{ '--tw-ring-color': primaryColor } as any}
                                disabled={loading}
                                autoFocus
                            />
                            {attemptsRemaining !== null && attemptsRemaining <= 2 && (
                                <p className="text-xs text-amber-600 mt-1 text-center">
                                    {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
                                </p>
                            )}
                        </div>

                        <div className="text-center">
                            <button
                                onClick={handleResend}
                                disabled={resendCooldown > 0 || loading}
                                className="text-sm font-medium hover:underline disabled:opacity-40 disabled:no-underline"
                                style={{ color: primaryColor }}
                            >
                                {resendCooldown > 0
                                    ? `Resend code in ${resendCooldown}s`
                                    : 'Resend Code'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 'new-password' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                New Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showNewPassword ? 'text' : 'password'}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Enter new password"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 pr-10"
                                    style={{ '--tw-ring-color': primaryColor } as any}
                                    disabled={loading}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2"
                                >
                                    {showNewPassword ? (
                                        <EyeOff className="w-5 h-5 text-gray-400" />
                                    ) : (
                                        <Eye className="w-5 h-5 text-gray-400" />
                                    )}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Confirm new password"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 pr-10"
                                    style={{ '--tw-ring-color': primaryColor } as any}
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2"
                                >
                                    {showConfirmPassword ? (
                                        <EyeOff className="w-5 h-5 text-gray-400" />
                                    ) : (
                                        <Eye className="w-5 h-5 text-gray-400" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                        <p className="text-sm text-red-600 text-center">{error}</p>
                    </div>
                )}

                {step === 'email' && (
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleRequestOtp}
                            disabled={loading || !email.trim()}
                            className="flex-1 py-3 px-4 rounded-xl font-medium text-white transition-colors disabled:opacity-50"
                            style={{ backgroundColor: buttonColor }}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Sending...
                                </span>
                            ) : (
                                'Send Code via Email'
                            )}
                        </button>
                    </div>
                )}

                {step === 'verify' && (
                    <div className="space-y-3 pt-2">
                        <button
                            onClick={handleVerifyOtp}
                            disabled={loading || code.length !== 4}
                            className="w-full py-3 px-4 rounded-xl font-medium text-white transition-colors disabled:opacity-50"
                            style={{ backgroundColor: buttonColor }}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Verifying...
                                </span>
                            ) : (
                                'Verify Code'
                            )}
                        </button>
                        <button
                            onClick={() => {
                                setStep('email')
                                setCode('')
                                setError('')
                                setAttemptsRemaining(null)
                            }}
                            className="w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"
                        >
                            <ArrowLeft className="w-4 h-4" /> Change email
                        </button>
                    </div>
                )}

                {step === 'new-password' && (
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSetPassword}
                            disabled={loading || !newPassword || !confirmPassword}
                            className="flex-1 py-3 px-4 rounded-xl font-medium text-white transition-colors disabled:opacity-50"
                            style={{ backgroundColor: buttonColor }}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Updating...
                                </span>
                            ) : (
                                'Update Password'
                            )}
                        </button>
                    </div>
                )}

                {step === 'success' && (
                    <div className="pt-2">
                        <button
                            onClick={() => {
                                onClose()
                                onBackToLogin()
                            }}
                            className="w-full py-3 px-4 rounded-xl font-medium text-white transition-colors"
                            style={{ backgroundColor: buttonColor }}
                        >
                            Back to Login
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
