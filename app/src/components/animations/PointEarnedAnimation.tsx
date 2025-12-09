'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { CheckCircle2, Sparkles, Star } from 'lucide-react'

interface PointEarnedAnimationProps {
  isOpen: boolean
  pointsEarned: number
  totalBalance: number
  previousBalance?: number
  onClose: () => void
  autoCloseDelay?: number // milliseconds, default 2500
  primaryColor?: string
}

// Animated number counter component
function AnimatedCounter({ 
  value, 
  duration = 1.5,
  className = ''
}: { 
  value: number
  duration?: number
  className?: string 
}) {
  const [displayValue, setDisplayValue] = useState(0)
  const startTime = useRef<number | null>(null)
  const animationFrame = useRef<number | null>(null)

  useEffect(() => {
    startTime.current = null
    
    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp
      const progress = Math.min((timestamp - startTime.current) / (duration * 1000), 1)
      
      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(Math.floor(easeOut * value))
      
      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate)
      } else {
        setDisplayValue(value)
      }
    }
    
    animationFrame.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current)
      }
    }
  }, [value, duration])

  return <span className={className}>{displayValue.toLocaleString()}</span>
}

// Star burst animation component
function StarBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2"
          initial={{ 
            x: '-50%', 
            y: '-50%', 
            scale: 0, 
            opacity: 1,
            rotate: i * 45
          }}
          animate={{ 
            x: `calc(-50% + ${Math.cos(i * Math.PI / 4) * 80}px)`,
            y: `calc(-50% + ${Math.sin(i * Math.PI / 4) * 80}px)`,
            scale: [0, 1.2, 0],
            opacity: [1, 1, 0],
            rotate: i * 45 + 180
          }}
          transition={{ 
            duration: 0.8, 
            delay: 0.2,
            ease: "easeOut"
          }}
        >
          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
        </motion.div>
      ))}
    </div>
  )
}

export function PointEarnedAnimation({
  isOpen,
  pointsEarned,
  totalBalance,
  previousBalance = 0,
  onClose,
  autoCloseDelay = 3500,
  primaryColor = '#22c55e'
}: PointEarnedAnimationProps) {
  const hasTriggered = useRef(false)

  // Trigger confetti on open
  useEffect(() => {
    if (isOpen && !hasTriggered.current) {
      hasTriggered.current = true
      
      // Fire confetti burst - slower, more dramatic
      const duration = 2500
      const animationEnd = Date.now() + duration
      const defaults = { 
        startVelocity: 25, 
        spread: 360, 
        ticks: 80, 
        zIndex: 10000,
        colors: ['#22c55e', '#fbbf24', '#3b82f6', '#ec4899', '#8b5cf6']
      }

      const randomInRange = (min: number, max: number) => {
        return Math.random() * (max - min) + min
      }

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now()

        if (timeLeft <= 0) {
          clearInterval(interval)
          return
        }

        const particleCount = 40 * (timeLeft / duration)
        
        // Confetti from both sides
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        })
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        })
      }, 250)

      // Auto-close timer
      const closeTimer = setTimeout(() => {
        onClose()
      }, autoCloseDelay)

      return () => {
        clearInterval(interval)
        clearTimeout(closeTimer)
      }
    }
  }, [isOpen, onClose, autoCloseDelay])

  // Reset trigger when closed
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
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{ 
              type: "spring", 
              damping: 20, 
              stiffness: 300,
              delay: 0.1
            }}
            className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm mx-auto relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Star burst effect */}
            <StarBurst />
            
            {/* Animated background gradient */}
            <motion.div 
              className="absolute inset-0 opacity-10"
              style={{
                background: `radial-gradient(circle at center, ${primaryColor} 0%, transparent 70%)`
              }}
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.1, 0.2, 0.1]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />

            {/* Content */}
            <div className="relative z-10 text-center">
              {/* Animated icon */}
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ 
                  type: "spring", 
                  damping: 10, 
                  stiffness: 200,
                  delay: 0.2 
                }}
                className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center relative"
                style={{ backgroundColor: `${primaryColor}15` }}
              >
                {/* Pulsing ring */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ border: `2px solid ${primaryColor}` }}
                  animate={{
                    scale: [1, 1.3, 1.3],
                    opacity: [0.5, 0, 0]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeOut"
                  }}
                />
                
                {/* Sparkle decoration */}
                <motion.div
                  className="absolute -top-1 -right-1"
                  animate={{
                    scale: [1, 1.2, 1],
                    rotate: [0, 15, 0]
                  }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    repeatDelay: 0.5
                  }}
                >
                  <Sparkles className="w-6 h-6 text-yellow-400" />
                </motion.div>
                
                <CheckCircle2 
                  className="w-10 h-10" 
                  style={{ color: primaryColor }}
                />
              </motion.div>

              {/* Title */}
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-bold text-gray-900 mb-2"
              >
                Congratulations!
              </motion.h2>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-gray-600 mb-6"
              >
                You've successfully collected points
              </motion.p>

              {/* Points display */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-gray-50 rounded-2xl p-4 mb-4 space-y-3"
              >
                {/* Points earned */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Points Earned</span>
                  <motion.span
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{ 
                      type: "spring", 
                      delay: 0.6,
                      damping: 8
                    }}
                    className="text-2xl font-bold"
                    style={{ color: primaryColor }}
                  >
                    +<AnimatedCounter value={pointsEarned} duration={1} />
                  </motion.span>
                </div>

                {/* Divider */}
                <div className="h-px bg-gray-200" />

                {/* Total balance */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Total Balance</span>
                  <span className="text-xl font-bold text-gray-900">
                    <AnimatedCounter 
                      value={totalBalance} 
                      duration={1.5} 
                    /> pts
                  </span>
                </div>
              </motion.div>

              {/* Done button */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full py-3 rounded-xl text-white font-semibold text-lg shadow-lg transition-shadow hover:shadow-xl"
                style={{ backgroundColor: primaryColor }}
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default PointEarnedAnimation
