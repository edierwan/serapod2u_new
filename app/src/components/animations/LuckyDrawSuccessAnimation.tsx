'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { Trophy, Sparkles, Star, Gift, Crown, PartyPopper } from 'lucide-react'

interface LuckyDrawSuccessAnimationProps {
  isOpen: boolean
  customerName: string
  customerPhone: string
  entryNumber?: string
  onClose: () => void
  autoCloseDelay?: number
}

// Animated counter for entry number effect
function AnimatedText({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayText, setDisplayText] = useState('')
  
  useEffect(() => {
    if (!text) return
    
    let currentIndex = 0
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        if (currentIndex <= text.length) {
          setDisplayText(text.slice(0, currentIndex))
          currentIndex++
        } else {
          clearInterval(interval)
        }
      }, 50)
      
      return () => clearInterval(interval)
    }, delay)
    
    return () => clearTimeout(timer)
  }, [text, delay])
  
  return <span>{displayText}</span>
}

// Floating confetti pieces for header
function FloatingConfetti() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            left: `${(i * 8.3) + Math.random() * 5}%`,
            top: '-20px'
          }}
          initial={{ y: -20, rotate: 0, opacity: 0 }}
          animate={{
            y: ['0%', '120%'],
            rotate: [0, 360 * (i % 2 === 0 ? 1 : -1)],
            opacity: [0, 1, 1, 0]
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            delay: i * 0.2,
            repeat: Infinity,
            ease: "linear"
          }}
        >
          {i % 3 === 0 ? (
            <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
          ) : i % 3 === 1 ? (
            <div className="w-3 h-3 rounded-full bg-amber-400" />
          ) : (
            <div className="w-2 h-4 rounded-full bg-orange-300 rotate-45" />
          )}
        </motion.div>
      ))}
    </div>
  )
}

// Trophy animation with shine effect
function AnimatedTrophy() {
  return (
    <motion.div
      className="relative"
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{
        type: "spring",
        damping: 10,
        stiffness: 100,
        delay: 0.2
      }}
    >
      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 rounded-full bg-yellow-400 blur-xl"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.3, 0.6, 0.3]
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* Trophy container */}
      <motion.div
        className="relative w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 flex items-center justify-center shadow-lg"
        animate={{
          boxShadow: [
            '0 0 20px rgba(251, 191, 36, 0.4)',
            '0 0 40px rgba(251, 191, 36, 0.6)',
            '0 0 20px rgba(251, 191, 36, 0.4)'
          ]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        <Trophy className="w-12 h-12 text-white drop-shadow-lg" />
        
        {/* Shine effect */}
        <motion.div
          className="absolute inset-0 rounded-full overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="absolute w-full h-8 bg-gradient-to-r from-transparent via-white/40 to-transparent -skew-x-12"
            animate={{
              top: ['-100%', '200%']
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: 1,
              ease: "easeInOut"
            }}
          />
        </motion.div>
      </motion.div>
      
      {/* Sparkles around trophy */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            left: '50%',
            top: '50%'
          }}
          initial={{ x: '-50%', y: '-50%', scale: 0 }}
          animate={{
            x: `calc(-50% + ${Math.cos(i * Math.PI / 3) * 50}px)`,
            y: `calc(-50% + ${Math.sin(i * Math.PI / 3) * 50}px)`,
            scale: [0, 1, 0],
            opacity: [0, 1, 0]
          }}
          transition={{
            duration: 1.5,
            delay: 0.5 + i * 0.1,
            repeat: Infinity,
            repeatDelay: 1
          }}
        >
          <Sparkles className="w-5 h-5 text-yellow-400" />
        </motion.div>
      ))}
    </motion.div>
  )
}

export function LuckyDrawSuccessAnimation({
  isOpen,
  customerName,
  customerPhone,
  entryNumber,
  onClose,
  autoCloseDelay = 3500
}: LuckyDrawSuccessAnimationProps) {
  const hasTriggered = useRef(false)

  useEffect(() => {
    if (isOpen && !hasTriggered.current) {
      hasTriggered.current = true
      
      // Fire golden confetti burst
      const duration = 3000
      const animationEnd = Date.now() + duration
      const colors = ['#fbbf24', '#f59e0b', '#d97706', '#fcd34d', '#fef3c7', '#ffffff']
      
      const defaults = {
        startVelocity: 30,
        spread: 360,
        ticks: 100,
        zIndex: 10000,
        colors
      }

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now()
        if (timeLeft <= 0) {
          clearInterval(interval)
          return
        }

        const particleCount = 50 * (timeLeft / duration)
        
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          shapes: ['star', 'circle']
        })
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          shapes: ['star', 'circle']
        })
      }, 300)

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
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{
              type: "spring",
              damping: 20,
              stiffness: 300,
              delay: 0.1
            }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm mx-auto relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with floating confetti */}
            <div className="relative bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600 pt-8 pb-16 text-center overflow-hidden">
              <FloatingConfetti />
              
              {/* Background decoration */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-4 left-8 w-6 h-6 rounded-full bg-white" />
                <div className="absolute top-12 right-6 w-4 h-4 rounded-full bg-white" />
                <div className="absolute bottom-8 left-4 w-8 h-8 rounded-full bg-white" />
                <div className="absolute bottom-4 right-12 w-5 h-5 rounded-full bg-white" />
              </div>
              
              <div className="relative z-10 flex flex-col items-center">
                <AnimatedTrophy />
                
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-2xl font-bold text-white mt-4 drop-shadow-lg"
                >
                  Lucky Draw
                </motion.h1>
              </div>
            </div>

            {/* Content */}
            <div className="relative -mt-8 px-6 pb-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white rounded-2xl shadow-lg p-6 text-center border border-gray-100"
              >
                {/* Success Icon */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{
                    type: "spring",
                    delay: 0.5,
                    damping: 10
                  }}
                  className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center"
                >
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1]
                    }}
                    transition={{
                      duration: 0.5,
                      delay: 0.7
                    }}
                  >
                    <PartyPopper className="w-8 h-8 text-green-600" />
                  </motion.div>
                </motion.div>

                <motion.h2
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="text-xl font-bold text-gray-900 mb-2"
                >
                  You're In!
                </motion.h2>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                  className="text-gray-600 text-sm mb-4"
                >
                  Your entry has been submitted successfully!
                </motion.p>

                {/* Entry Details */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 text-left border border-amber-200"
                >
                  <p className="text-xs text-amber-700 font-medium mb-2 flex items-center gap-1">
                    <Gift className="w-3 h-3" />
                    Entry Details
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{customerName}</p>
                  <p className="text-sm text-gray-600">{customerPhone}</p>
                  {entryNumber && (
                    <p className="text-xs text-amber-600 mt-2 font-mono">
                      Entry #<AnimatedText text={entryNumber} delay={1000} />
                    </p>
                  )}
                </motion.div>

                {/* Good luck message */}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1 }}
                  className="text-sm text-gray-500 mt-4 flex items-center justify-center gap-1"
                >
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  Good luck!
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                </motion.p>
              </motion.div>

              {/* Done Button */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full mt-4 py-3 rounded-xl text-white font-semibold text-lg bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg hover:shadow-xl transition-shadow"
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

export default LuckyDrawSuccessAnimation
