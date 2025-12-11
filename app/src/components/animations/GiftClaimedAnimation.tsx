'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift, Sparkles } from 'lucide-react'
import confetti from 'canvas-confetti'

interface GiftClaimedAnimationProps {
    isVisible: boolean
    giftName: string
    onClose: () => void
}

export function GiftClaimedAnimation({ 
    isVisible, 
    giftName, 
    onClose 
}: GiftClaimedAnimationProps) {
    useEffect(() => {
        if (isVisible) {
            // Trigger colorful confetti burst
            const duration = 3000;
            const animationEnd = Date.now() + duration;
            const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

            const randomInRange = (min: number, max: number) => {
                return Math.random() * (max - min) + min;
            }

            const interval: any = setInterval(function() {
                const timeLeft = animationEnd - Date.now();

                if (timeLeft <= 0) {
                    return clearInterval(interval);
                }

                const particleCount = 50 * (timeLeft / duration);
                
                // since particles fall down, start a bit higher than random
                confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
                confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
            }, 250);

            // Auto close after 5 seconds
            const timer = setTimeout(() => {
                onClose();
            }, 5000);

            return () => {
                clearInterval(interval);
                clearTimeout(timer);
            }
        }
    }, [isVisible, onClose])

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={onClose}
                >
                    <div className="relative w-full max-w-md" onClick={e => e.stopPropagation()}>
                        {/* Background Glow */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-green-500/30 rounded-full blur-3xl animate-pulse" />

                        <motion.div
                            initial={{ scale: 0.5, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{ type: "spring", duration: 0.6 }}
                            className="relative bg-white rounded-3xl p-8 text-center shadow-2xl overflow-hidden"
                        >
                            {/* Decorative Elements */}
                            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500" />
                            <Sparkles className="absolute top-4 right-4 w-6 h-6 text-yellow-400 animate-pulse" />
                            <Sparkles className="absolute bottom-4 left-4 w-6 h-6 text-yellow-400 animate-pulse delay-75" />

                            {/* Icon */}
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: "spring", delay: 0.2, duration: 0.8 }}
                                className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center shadow-inner"
                            >
                                <Gift className="w-12 h-12 text-green-600" />
                            </motion.div>

                            {/* Text Content */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                            >
                                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                                    Congratulations!
                                </h2>
                                <div className="w-16 h-1 bg-green-500 mx-auto rounded-full mb-4" />
                                <p className="text-lg text-gray-600 mb-2">
                                    You've successfully claimed
                                </p>
                                <p className="text-xl font-bold text-green-600 mb-6">
                                    {giftName}
                                </p>
                                <p className="text-sm text-gray-500">
                                    Enjoy your free gift!
                                </p>
                            </motion.div>
                        </motion.div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
