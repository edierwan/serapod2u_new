'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift, Check, Sparkles, Package, Clock, MapPin, Building2 } from 'lucide-react'
import confetti from 'canvas-confetti'

interface RewardRedemptionAnimationProps {
    isOpen: boolean
    rewardName: string
    pointsDeducted: number
    newBalance: number
    redemptionCode: string
    onClose: () => void
    autoCloseDelay?: number
    // Optional delivery info
    isCashback?: boolean
    deliveryAddress?: string
    bankName?: string
    bankAccount?: string
    bankHolder?: string
}

export function RewardRedemptionAnimation({
    isOpen,
    rewardName,
    pointsDeducted,
    newBalance,
    redemptionCode,
    onClose,
    autoCloseDelay = 0, // 0 means no auto-close, user must click Done
    isCashback = false,
    deliveryAddress,
    bankName,
    bankAccount,
    bankHolder
}: RewardRedemptionAnimationProps) {
    const [showCheck, setShowCheck] = useState(false)
    const [showDetails, setShowDetails] = useState(false)

    useEffect(() => {
        if (isOpen) {
            // Trigger confetti
            const colors = ['#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7']
            
            confetti({
                particleCount: 100,
                spread: 100,
                origin: { y: 0.5 },
                colors: colors,
                scalar: 1.2,
                gravity: 0.8
            })

            // Show checkmark after brief delay
            const checkTimer = setTimeout(() => setShowCheck(true), 400)
            // Show details after checkmark
            const detailsTimer = setTimeout(() => setShowDetails(true), 700)
            
            // Auto-close if delay is set
            if (autoCloseDelay > 0) {
                const closeTimer = setTimeout(onClose, autoCloseDelay)
                return () => {
                    clearTimeout(checkTimer)
                    clearTimeout(detailsTimer)
                    clearTimeout(closeTimer)
                }
            }

            return () => {
                clearTimeout(checkTimer)
                clearTimeout(detailsTimer)
            }
        } else {
            setShowCheck(false)
            setShowDetails(false)
        }
    }, [isOpen, autoCloseDelay, onClose])

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                >
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0, y: 50 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.5, opacity: 0, y: 50 }}
                        transition={{ 
                            type: 'spring', 
                            stiffness: 300, 
                            damping: 25 
                        }}
                        className="relative bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl overflow-hidden"
                    >
                        {/* Background decoration */}
                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-100 rounded-full blur-3xl opacity-30" />
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-green-100 rounded-full blur-3xl opacity-30" />

                        {/* Main content */}
                        <div className="relative z-10 text-center">
                            {/* Success icon */}
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ 
                                    type: 'spring',
                                    stiffness: 200,
                                    damping: 15,
                                    delay: 0.1
                                }}
                                className="inline-flex items-center justify-center mb-6"
                            >
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
                                        <Gift className="w-12 h-12 text-white" />
                                    </div>
                                    {showCheck && (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 500 }}
                                            className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-lg"
                                        >
                                            <Check className="w-6 h-6 text-white" strokeWidth={3} />
                                        </motion.div>
                                    )}
                                </div>
                            </motion.div>

                            {/* Title */}
                            <motion.h2
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="text-2xl font-bold text-gray-900 mb-2"
                            >
                                Redemption Successful! 🎉
                            </motion.h2>

                            <motion.p
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                className="text-gray-600 text-sm mb-6"
                            >
                                Your reward is being prepared for delivery
                            </motion.p>

                            {/* Reward details */}
                            {showDetails && (
                                <motion.div
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.5 }}
                                    className="space-y-4 mb-6"
                                >
                                    {/* Reward name */}
                                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100">
                                        <div className="flex items-center gap-3">
                                            <Package className="w-5 h-5 text-amber-600 flex-shrink-0" />
                                            <div className="flex-1 text-left">
                                                <p className="text-xs text-gray-500 mb-1">Reward</p>
                                                <p className="font-semibold text-gray-900">{rewardName}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Points info */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-gray-50 rounded-xl p-3 text-left">
                                            <p className="text-xs text-gray-500 mb-1">Points Used</p>
                                            <p className="text-lg font-bold text-red-600">-{pointsDeducted}</p>
                                        </div>
                                        <div className="bg-gray-50 rounded-xl p-3 text-left">
                                            <p className="text-xs text-gray-500 mb-1">New Balance</p>
                                            <p className="text-lg font-bold text-green-600">{newBalance}</p>
                                        </div>
                                    </div>

                                    {/* Redemption code */}
                                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Sparkles className="w-5 h-5 text-blue-600" />
                                            <p className="text-xs font-medium text-gray-600">Redemption Code</p>
                                        </div>
                                        <p className="text-2xl font-mono font-bold text-blue-900 tracking-wider">
                                            {redemptionCode}
                                        </p>
                                    </div>

                                    {/* Processing message with delivery/bank info */}
                                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-100">
                                        {isCashback && bankName && bankAccount && bankHolder ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 text-green-700">
                                                    <Building2 className="w-5 h-5" />
                                                    <p className="text-sm font-medium">Your cash will be transferred to:</p>
                                                </div>
                                                <div className="bg-white/60 rounded-xl p-3 space-y-1">
                                                    <p className="text-sm"><span className="text-gray-500">Bank:</span> <span className="font-semibold text-gray-900">{bankName}</span></p>
                                                    <p className="text-sm"><span className="text-gray-500">Account:</span> <span className="font-semibold text-gray-900">{bankAccount}</span></p>
                                                    <p className="text-sm"><span className="text-gray-500">Holder:</span> <span className="font-semibold text-gray-900">{bankHolder}</span></p>
                                                </div>
                                            </div>
                                        ) : !isCashback && deliveryAddress ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 text-green-700">
                                                    <MapPin className="w-5 h-5" />
                                                    <p className="text-sm font-medium">Your item will be delivered to:</p>
                                                </div>
                                                <div className="bg-white/60 rounded-xl p-3">
                                                    <p className="text-sm font-semibold text-gray-900">{deliveryAddress}</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                                                <Clock className="w-4 h-4" />
                                                <p>Your reward will be processed and delivered soon</p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {/* Done button */}
                            {showDetails && (
                                <motion.button
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.7 }}
                                    onClick={onClose}
                                    className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-4 rounded-2xl transition-all transform hover:scale-105 active:scale-95 shadow-lg"
                                >
                                    Done
                                </motion.button>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
