'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, CheckCircle2, Sparkles } from 'lucide-react'
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
}

export function GenuineProductAnimation({ 
    isVisible, 
    productInfo, 
    onClose 
}: GenuineProductAnimationProps) {
    const [showCheckmark, setShowCheckmark] = useState(false)

    useEffect(() => {
        if (isVisible) {
            // Trigger green confetti burst
            const colors = ['#22c55e', '#16a34a', '#4ade80', '#86efac', '#dcfce7']
            
            confetti({
                particleCount: 80,
                spread: 70,
                origin: { y: 0.4 },
                colors: colors,
                scalar: 0.8
            })

            // Show checkmark after brief delay
            const timer = setTimeout(() => setShowCheckmark(true), 300)
            return () => clearTimeout(timer)
        } else {
            setShowCheckmark(false)
        }
    }, [isVisible])

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
                                ✓ Genuine Product
                            </motion.h2>

                            <motion.p
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                className="text-white/80 text-center text-sm mb-4"
                            >
                                This product is verified authentic
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
