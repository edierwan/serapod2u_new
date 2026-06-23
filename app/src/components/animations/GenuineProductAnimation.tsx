'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, CheckCircle2, Sparkles, PawPrint } from 'lucide-react'
import confetti from 'canvas-confetti'

interface ProductInfo {
    product_name?: string
    variant_name?: string
    brand_name?: string
}

interface GenuineProductAnimationProps {
    isVisible: boolean
    productInfo?: ProductInfo
    onClose: () => void
    title?: string
    subtitle?: string
    /**
     * When true, render the Ellbow Pet Food themed success popup (teal/mint,
     * cat mascot + verified shield, paw/heart/sparkle celebration). Defaults to
     * the existing green Vape/legacy presentation so Cellera flows are untouched.
     */
    ellbow?: boolean
}

const ELLBOW_ASSET = '/images/ellbow-mobile-ready-assets/png'

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Ellbow celebration: confetti + paw prints + sparkles + hearts in the Ellbow
 * palette, fired once when the popup opens. Everything is drawn on the
 * canvas-confetti canvas (pointer-events: none, no extra DOM), randomized per
 * opening, ~2.5s total, and disabled under prefers-reduced-motion.
 */
function fireEllbowCelebration() {
    if (prefersReducedMotion()) return

    const rand = (min: number, max: number) => min + Math.random() * (max - min)
    const count = (min: number, max: number) => Math.round(rand(min, max))
    // teal, aqua, mint, soft pink, coral, gold
    const confettiColors = ['#1b8884', '#42aaa4', '#9ae6df', '#f9a8c9', '#fb7185', '#fcd34d']
    const paw = confetti.shapeFromText({ text: '🐾', scalar: 2.2 })
    const heart = confetti.shapeFromText({ text: '💗', scalar: 2 })
    const sparkle = confetti.shapeFromText({ text: '✨', scalar: 1.8 })
    const common = { disableForReducedMotion: true as const, zIndex: 70 }

    // 1) Confetti falling from the top across the width.
    confetti({
        ...common,
        particleCount: count(42, 60),
        startVelocity: rand(24, 34),
        spread: rand(55, 80),
        angle: 90,
        origin: { x: rand(0.3, 0.7), y: 0 },
        gravity: 0.9,
        scalar: rand(0.7, 0.95),
        ticks: 200,
        colors: confettiColors,
    })

    // 2) Paw prints drifting diagonally from each top corner.
    confetti({
        ...common,
        particleCount: count(6, 9),
        startVelocity: rand(28, 40),
        spread: 50,
        angle: rand(55, 75),
        origin: { x: 0, y: rand(0.1, 0.3) },
        drift: rand(0.6, 1.3),
        gravity: 0.8,
        scalar: rand(1.8, 2.4),
        ticks: 220,
        shapes: [paw],
        colors: ['#1b8884', '#399991', '#42aaa4'],
    })
    confetti({
        ...common,
        particleCount: count(6, 9),
        startVelocity: rand(28, 40),
        spread: 50,
        angle: rand(105, 125),
        origin: { x: 1, y: rand(0.1, 0.3) },
        drift: -rand(0.6, 1.3),
        gravity: 0.8,
        scalar: rand(1.8, 2.4),
        ticks: 220,
        shapes: [paw],
        colors: ['#1b8884', '#399991', '#42aaa4'],
    })

    // 3) Sparkles bursting around the verified shield / mascot (center-top).
    window.setTimeout(() => {
        confetti({
            ...common,
            particleCount: count(8, 12),
            startVelocity: rand(8, 16),
            spread: 360,
            origin: { x: 0.5, y: 0.34 },
            gravity: 0.4,
            scalar: rand(1.2, 1.8),
            ticks: 130,
            shapes: [sparkle],
            colors: ['#fcd34d', '#ffffff', '#9ae6df'],
        })
    }, 180)

    // 4) One or two hearts gently floating upward.
    window.setTimeout(() => {
        confetti({
            ...common,
            particleCount: count(2, 4),
            startVelocity: rand(22, 30),
            spread: 30,
            angle: 90,
            origin: { x: rand(0.4, 0.6), y: 0.55 },
            drift: rand(-0.4, 0.4),
            gravity: 0.25,
            scalar: 2,
            ticks: 200,
            shapes: [heart],
            colors: ['#f9a8c9', '#fb7185'],
        })
    }, 320)
}

export function GenuineProductAnimation({
    isVisible,
    productInfo,
    onClose,
    title,
    subtitle,
    ellbow = false,
}: GenuineProductAnimationProps) {
    const [showCheckmark, setShowCheckmark] = useState(false)
    const [reduceMotion, setReduceMotion] = useState(false)
    const resolvedTitle = title || '✓ Genuine Product'
    const resolvedSubtitle = subtitle || (productInfo?.product_name
        ? `${productInfo.product_name} is verified authentic`
        : 'This product is verified authentic')

    useEffect(() => {
        if (isVisible) {
            setReduceMotion(prefersReducedMotion())
            if (ellbow) {
                fireEllbowCelebration()
            } else {
                // Existing green confetti burst (unchanged for Vape/legacy).
                const colors = ['#22c55e', '#16a34a', '#4ade80', '#86efac', '#dcfce7']
                confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 }, colors, scalar: 0.8 })
            }
            const timer = setTimeout(() => setShowCheckmark(true), 300)
            return () => clearTimeout(timer)
        } else {
            setShowCheckmark(false)
        }
    }, [isVisible, ellbow])

    if (ellbow) {
        return (
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
                        onClick={onClose}
                    >
                        <motion.div
                            initial={{ scale: 0.7, opacity: 0, y: 24 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.7, opacity: 0, y: 24 }}
                            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                            className="relative w-full max-w-sm overflow-hidden rounded-[28px] bg-white shadow-[0_24px_60px_rgba(15,72,70,0.35)]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header: teal hero with verified shield + waving mascot */}
                            <div
                                className="relative h-[188px] overflow-hidden px-6 pt-6"
                                style={{ background: 'linear-gradient(135deg,#1b8884 0%,#42aaa4 100%)' }}
                            >
                                <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-white/[0.07]" />
                                <div className="absolute -left-8 -bottom-6 h-28 w-28 rounded-full bg-white/[0.06]" />
                                {/* Soft static paw decorations (also the reduced-motion fallback) */}
                                <PawPrint className="absolute left-6 top-7 h-5 w-5 rotate-[-18deg] text-white/20" />
                                <PawPrint className="absolute left-16 top-20 h-4 w-4 rotate-[12deg] text-white/15" />
                                {reduceMotion && (
                                    <>
                                        <Sparkles className="absolute right-24 top-6 h-5 w-5 text-amber-200/80" />
                                        <Sparkles className="absolute left-10 bottom-8 h-4 w-4 text-amber-200/70" />
                                    </>
                                )}
                                <Image
                                    src={`${ELLBOW_ASSET}/01-ellbow-cat-mascot-full.png`}
                                    alt="Ellbow cat mascot"
                                    width={180}
                                    height={190}
                                    priority
                                    className="absolute -right-3 bottom-[-12px] z-10 h-[168px] w-[150px] object-contain object-bottom"
                                />
                                <div className="relative z-20 w-[62%] text-center">
                                    <motion.div
                                        initial={{ scale: 0, rotate: -160 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}
                                        className="relative mx-auto w-fit"
                                    >
                                        <Image
                                            src={`${ELLBOW_ASSET}/04-ellbow-verified-shield-cat.png`}
                                            alt="Verified"
                                            width={104}
                                            height={104}
                                            priority
                                            className="mx-auto h-[88px] w-[88px] object-contain drop-shadow-md"
                                        />
                                        {showCheckmark && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: 'spring', stiffness: 400 }}
                                                className="absolute -bottom-1 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md"
                                            >
                                                <CheckCircle2 className="h-5 w-5 text-[#1b8884]" />
                                            </motion.div>
                                        )}
                                    </motion.div>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="px-6 pb-6 pt-5 text-center">
                                <motion.h2
                                    initial={{ y: 16, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.25 }}
                                    className="text-[22px] font-extrabold leading-tight tracking-tight text-[#15807b]"
                                >
                                    {resolvedTitle}
                                </motion.h2>
                                <motion.p
                                    initial={{ y: 16, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.33 }}
                                    className="mx-auto mt-2 max-w-[16rem] text-[13px] leading-snug text-gray-500"
                                >
                                    {resolvedSubtitle}
                                </motion.p>

                                {/* Campaign info card */}
                                {productInfo?.product_name && (
                                    <motion.div
                                        initial={{ y: 16, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: 0.42 }}
                                        className="mt-4 flex items-center gap-3 rounded-[20px] border border-[#e3f1ef] bg-[#f3faf9] p-3.5 text-left"
                                    >
                                        <div className="h-[58px] w-[58px] flex-shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm">
                                            <Image
                                                src={`${ELLBOW_ASSET}/06-ellbow-rewards-gift-icon.png`}
                                                alt=""
                                                aria-hidden
                                                width={58}
                                                height={58}
                                                className="h-full w-full object-contain p-1.5"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 text-[15px] font-extrabold leading-tight text-[#11162a]">
                                                {productInfo.product_name}
                                            </p>
                                            {productInfo.variant_name && (
                                                <p className="mt-0.5 truncate text-[12.5px] font-bold text-[#df3974]">
                                                    {productInfo.variant_name}
                                                </p>
                                            )}
                                            {productInfo.brand_name && (
                                                <p className="mt-0.5 truncate text-[11px] text-gray-400">by {productInfo.brand_name}</p>
                                            )}
                                        </div>
                                    </motion.div>
                                )}

                                {/* Continue hint */}
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.8 }}
                                    className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#3aa49c]"
                                >
                                    <PawPrint className="h-3.5 w-3.5" />
                                    <span>Tap anywhere to continue</span>
                                </motion.div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        )
    }

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
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{
                            type: 'spring',
                            stiffness: 300,
                            damping: 25
                        }}
                        className="relative bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-8 mx-6 shadow-2xl max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Decorative sparkles */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="absolute top-4 right-4"
                        >
                            <Sparkles className="w-6 h-6 text-yellow-300" />
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.7 }}
                            className="absolute bottom-6 left-6"
                        >
                            <Sparkles className="w-4 h-4 text-yellow-300" />
                        </motion.div>

                        {/* Shield with checkmark */}
                        <div className="flex flex-col items-center text-white">
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 200,
                                    damping: 15,
                                    delay: 0.1
                                }}
                                className="relative mb-4"
                            >
                                <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center">
                                    <Shield className="w-12 h-12 text-white" />
                                    {showCheckmark && (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 400 }}
                                            className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-lg"
                                        >
                                            <CheckCircle2 className="w-7 h-7 text-green-500" />
                                        </motion.div>
                                    )}
                                </div>
                            </motion.div>

                            {/* Title */}
                            <motion.h2
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="text-2xl font-bold text-center mb-2"
                            >
                                {resolvedTitle}
                            </motion.h2>

                            <motion.p
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                className="text-white/80 text-center text-sm mb-4"
                            >
                                {resolvedSubtitle}
                            </motion.p>

                            {/* Product Info */}
                            {productInfo?.product_name && (
                                <motion.div
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.5 }}
                                    className="bg-white/10 backdrop-blur-sm rounded-xl p-4 w-full mt-2"
                                >
                                    <p className="text-lg font-semibold text-center">
                                        {productInfo.product_name}
                                    </p>
                                    {productInfo.variant_name && (
                                        <p className="text-white/80 text-sm text-center mt-1">
                                            {productInfo.variant_name}
                                        </p>
                                    )}
                                    {productInfo.brand_name && (
                                        <p className="text-white/60 text-xs text-center mt-1">
                                            by {productInfo.brand_name}
                                        </p>
                                    )}
                                </motion.div>
                            )}

                            {/* Tap to continue hint */}
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 1 }}
                                className="text-white/50 text-xs mt-6"
                            >
                                Tap anywhere to continue
                            </motion.p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
