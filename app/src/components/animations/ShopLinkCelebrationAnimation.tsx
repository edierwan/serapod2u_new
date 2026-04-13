'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { Sparkles, Store } from 'lucide-react'

interface ShopLinkCelebrationAnimationProps {
    isOpen: boolean
    shopName: string
    onClose: () => void
    autoCloseDelay?: number
    primaryColor?: string
}

export function ShopLinkCelebrationAnimation({
    isOpen,
    shopName,
    onClose,
    autoCloseDelay = 2600,
    primaryColor = '#16a34a',
}: ShopLinkCelebrationAnimationProps) {
    const hasTriggered = useRef(false)

    useEffect(() => {
        if (!isOpen || hasTriggered.current) return

        hasTriggered.current = true

        confetti({
            particleCount: 90,
            spread: 80,
            startVelocity: 26,
            ticks: 120,
            scalar: 0.95,
            zIndex: 10000,
            colors: [primaryColor, '#f59e0b', '#fef3c7', '#ffffff'],
            origin: { x: 0.5, y: 0.4 },
        })

        const timer = setTimeout(() => {
            onClose()
        }, autoCloseDelay)

        return () => clearTimeout(timer)
    }, [autoCloseDelay, isOpen, onClose, primaryColor])

    useEffect(() => {
        if (!isOpen) {
            hasTriggered.current = false
        }
    }, [isOpen])

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 backdrop-blur-sm px-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.86, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -16 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                        onClick={(event) => event.stopPropagation()}
                        className="relative w-full max-w-sm overflow-hidden rounded-[28px] bg-white p-6 text-center shadow-2xl"
                    >
                        <motion.div
                            className="absolute inset-0 opacity-10"
                            style={{
                                background: `radial-gradient(circle at top, ${primaryColor} 0%, transparent 68%)`,
                            }}
                            animate={{ scale: [1, 1.08, 1], opacity: [0.08, 0.16, 0.08] }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                        />

                        <div className="relative z-10">
                            <motion.div
                                initial={{ scale: 0.7, rotate: -12 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.1, type: 'spring', stiffness: 320, damping: 18 }}
                                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                                style={{ backgroundColor: `${primaryColor}18` }}
                            >
                                <Store className="h-8 w-8" style={{ color: primaryColor }} />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.18 }}
                                className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700"
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                RoadTour Joined
                            </motion.div>

                            <motion.h3
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.24 }}
                                className="text-2xl font-black text-gray-900"
                            >
                                Thanks {shopName} for Joining RoadTour!
                            </motion.h3>

                            <motion.p
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="mt-3 text-sm leading-6 text-gray-700"
                            >
                                We appreciate your participation and support.
                            </motion.p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
