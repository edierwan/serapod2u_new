'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift, CheckCircle2, Sparkles, Star, PartyPopper, Coins } from 'lucide-react'
import confetti from 'canvas-confetti'

interface RegistrationCelebrationProps {
    isVisible: boolean
    userName: string
    bonusPoints: number
    bonusAwarded: boolean
    bonusMode: string | null
    onClose: () => void
}

export function RegistrationCelebrationAnimation({
    isVisible,
    userName,
    bonusPoints,
    bonusAwarded,
    bonusMode,
    onClose,
}: RegistrationCelebrationProps) {
    const [showCheckmark, setShowCheckmark] = useState(false)
    const [showPoints, setShowPoints] = useState(false)
    const [countUp, setCountUp] = useState(0)

    const fireConfetti = useCallback(() => {
        // First burst — gold/orange celebration
        confetti({
            particleCount: 100,
            spread: 80,
            origin: { y: 0.35, x: 0.5 },
            colors: ['#f59e0b', '#f97316', '#eab308', '#fbbf24', '#fde68a', '#ffffff'],
            scalar: 1,
            gravity: 0.8,
        })

        // Second burst — delayed side bursts
        setTimeout(() => {
            confetti({
                particleCount: 40,
                angle: 60,
                spread: 50,
                origin: { x: 0, y: 0.5 },
                colors: ['#f59e0b', '#f97316', '#22c55e', '#fbbf24'],
                scalar: 0.8,
            })
            confetti({
                particleCount: 40,
                angle: 120,
                spread: 50,
                origin: { x: 1, y: 0.5 },
                colors: ['#f59e0b', '#f97316', '#22c55e', '#fbbf24'],
                scalar: 0.8,
            })
        }, 300)

        // Third burst — star shower
        if (bonusPoints > 0) {
            setTimeout(() => {
                confetti({
                    particleCount: 60,
                    spread: 100,
                    origin: { y: 0.3 },
                    colors: ['#fbbf24', '#f59e0b', '#ffffff', '#fde68a'],
                    shapes: ['star'],
                    scalar: 1.2,
                })
            }, 600)
        }
    }, [bonusPoints])

    useEffect(() => {
        if (isVisible) {
            fireConfetti()
            const t1 = setTimeout(() => setShowCheckmark(true), 400)
            const t2 = setTimeout(() => setShowPoints(true), 800)
            return () => { clearTimeout(t1); clearTimeout(t2) }
        } else {
            setShowCheckmark(false)
            setShowPoints(false)
            setCountUp(0)
        }
    }, [isVisible, fireConfetti])

    // Animate count up
    useEffect(() => {
        if (!showPoints || bonusPoints <= 0) return
        const duration = 1200
        const steps = 30
        const interval = duration / steps
        const increment = bonusPoints / steps
        let current = 0
        const timer = setInterval(() => {
            current += increment
            if (current >= bonusPoints) {
                setCountUp(bonusPoints)
                clearInterval(timer)
            } else {
                setCountUp(Math.round(current))
            }
        }, interval)
        return () => clearInterval(timer)
    }, [showPoints, bonusPoints])

    const firstName = userName?.split(' ')[0] || 'there'
    const hasBonusInfo = bonusPoints > 0

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.3, opacity: 0, y: 40 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.3, opacity: 0, y: 40 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                        className="relative overflow-hidden rounded-3xl mx-5 shadow-2xl max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Gradient background */}
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500" />
                        {/* Shimmer overlay */}
                        <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
                        />

                        <div className="relative p-8">
                            {/* Floating sparkles */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.5 }}
                                className="absolute top-3 right-4"
                            >
                                <Star className="w-5 h-5 text-yellow-200 fill-yellow-200" />
                            </motion.div>
                            <motion.div
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.7 }}
                                className="absolute top-8 left-5"
                            >
                                <Sparkles className="w-5 h-5 text-yellow-200" />
                            </motion.div>
                            <motion.div
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.9 }}
                                className="absolute bottom-20 right-6"
                            >
                                <Star className="w-4 h-4 text-yellow-200/70 fill-yellow-200/70" />
                            </motion.div>

                            {/* Icon */}
                            <div className="flex flex-col items-center text-white">
                                <motion.div
                                    initial={{ scale: 0, rotate: -180 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
                                    className="relative mb-5"
                                >
                                    <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center ring-4 ring-white/30">
                                        <PartyPopper className="w-12 h-12 text-white" />
                                        {showCheckmark && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: 'spring', stiffness: 400 }}
                                                className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-lg"
                                            >
                                                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                                            </motion.div>
                                        )}
                                    </div>
                                </motion.div>

                                {/* Congratulations */}
                                <motion.h2
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                    className="text-2xl font-bold text-center mb-1"
                                >
                                    🎉 Welcome, {firstName}!
                                </motion.h2>

                                <motion.p
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.4 }}
                                    className="text-white/85 text-center text-sm mb-5"
                                >
                                    Your account has been created successfully
                                </motion.p>

                                {/* Points Card */}
                                {hasBonusInfo && (
                                    <motion.div
                                        initial={{ y: 30, opacity: 0, scale: 0.9 }}
                                        animate={{ y: 0, opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.7, type: 'spring', stiffness: 250, damping: 20 }}
                                        className="bg-white/15 backdrop-blur-md rounded-2xl p-5 w-full border border-white/20"
                                    >
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="w-8 h-8 rounded-full bg-yellow-400/30 flex items-center justify-center">
                                                <Coins className="w-4 h-4 text-yellow-200" />
                                            </div>
                                            <p className="text-white/90 text-sm font-medium">Welcome Bonus</p>
                                        </div>

                                        {bonusAwarded ? (
                                            <>
                                                <motion.div
                                                    className="text-center"
                                                    initial={{ scale: 0.8 }}
                                                    animate={{ scale: 1 }}
                                                    transition={{ delay: 1, type: 'spring' }}
                                                >
                                                    <p className="text-4xl font-black tracking-tight">
                                                        +{showPoints ? countUp : 0}
                                                    </p>
                                                    <p className="text-white/80 text-sm mt-1">
                                                        points credited to your account
                                                    </p>
                                                </motion.div>
                                            </>
                                        ) : (
                                            <div className="text-center">
                                                <p className="text-3xl font-black tracking-tight">
                                                    {bonusPoints} pts
                                                </p>
                                                <p className="text-white/80 text-xs mt-1">
                                                    {bonusMode === 'conditional'
                                                        ? 'Bonus will be credited after meeting the scan requirements'
                                                        : 'Welcome bonus pending'}
                                                </p>
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                {/* Dismiss */}
                                <motion.p
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 1.5 }}
                                    className="text-white/50 text-xs mt-6"
                                >
                                    Tap anywhere to continue
                                </motion.p>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
