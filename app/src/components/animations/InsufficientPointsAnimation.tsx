'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Ghost, Frown, Ban, XCircle, AlertTriangle, Coins } from 'lucide-react'

interface InsufficientPointsAnimationProps {
  isOpen: boolean
  pointsNeeded: number
  pointsAvailable: number
  onClose: () => void
  primaryColor?: string
}

// Funny cartoon character 1 - Sad Ghost
function SadGhostAnimation() {
  return (
    <div className="relative">
      {/* Ghost tears */}
      <motion.div
        className="absolute top-12 left-4 w-2 h-4 bg-blue-300 rounded-full opacity-60"
        animate={{
          y: [0, 20, 40],
          opacity: [0.8, 0.6, 0],
          scale: [1, 0.8, 0.5]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          repeatDelay: 0.5
        }}
      />
      <motion.div
        className="absolute top-14 right-4 w-2 h-4 bg-blue-300 rounded-full opacity-60"
        animate={{
          y: [0, 20, 40],
          opacity: [0.8, 0.6, 0],
          scale: [1, 0.8, 0.5]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          repeatDelay: 0.3,
          delay: 0.2
        }}
      />
      
      {/* Main ghost */}
      <motion.div
        className="relative bg-gradient-to-br from-purple-100 to-purple-200 p-6 rounded-full shadow-lg"
        animate={{
          y: [0, -8, 0],
          rotate: [-5, 5, -5]
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        <Ghost className="w-16 h-16 text-purple-500" />
        
        {/* Sad face overlay */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
        >
          <div className="relative top-2">
            <span className="text-3xl">😢</span>
          </div>
        </motion.div>
      </motion.div>
      
      {/* Floating X marks */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-red-400"
          style={{
            top: `${-20 + i * 10}px`,
            left: `${50 + i * 20}px`
          }}
          animate={{
            y: [-10, -30],
            x: [0, (i - 1) * 15],
            opacity: [0, 1, 0],
            rotate: [0, 360]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.5
          }}
        >
          <XCircle className="w-4 h-4" />
        </motion.div>
      ))}
    </div>
  )
}

// Funny cartoon character 2 - Confused Emoji with Spinning Coins
function ConfusedCoinAnimation() {
  return (
    <div className="relative">
      {/* Spinning coins flying away */}
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            top: '50%',
            left: '50%'
          }}
          animate={{
            x: [0, (i - 2) * 40],
            y: [-20, -60 - Math.random() * 30],
            rotate: [0, 720],
            opacity: [1, 1, 0]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            repeatDelay: 1,
            delay: i * 0.15
          }}
        >
          <div className="bg-yellow-400 rounded-full p-1 shadow-md">
            <Coins className="w-4 h-4 text-yellow-700" />
          </div>
        </motion.div>
      ))}
      
      {/* Main character - Confused face with empty wallet */}
      <motion.div
        className="relative bg-gradient-to-br from-orange-100 to-red-100 p-6 rounded-full shadow-lg"
        animate={{
          scale: [1, 1.05, 1],
          rotate: [-3, 3, -3]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        <motion.div
          animate={{
            rotateY: [0, 180, 360]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear"
          }}
        >
          <Coins className="w-16 h-16 text-gray-400" />
        </motion.div>
        
        {/* Confused face overlay */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        >
          <div className="relative top-1">
            <span className="text-3xl">🤷</span>
          </div>
        </motion.div>
      </motion.div>
      
      {/* Question marks */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-2xl"
          style={{
            top: `${-10 + i * 5}px`,
            right: `${-20 + i * 10}px`
          }}
          animate={{
            y: [0, -15, 0],
            rotate: [-10, 10, -10],
            scale: [0.8, 1.2, 0.8]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: i * 0.3
          }}
        >
          ❓
        </motion.div>
      ))}
    </div>
  )
}

// Funny cartoon character 3 - Dramatic "No Entry" with Alarm
function DramaticNoEntryAnimation() {
  return (
    <div className="relative">
      {/* Alarm rays */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute top-1/2 left-1/2 origin-center"
          style={{
            rotate: `${i * 45}deg`
          }}
        >
          <motion.div
            className="w-1 h-12 bg-gradient-to-t from-transparent to-red-400 rounded-full"
            style={{ transformOrigin: 'bottom center' }}
            animate={{
              scaleY: [0.3, 1, 0.3],
              opacity: [0.3, 0.8, 0.3]
            }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.1
            }}
          />
        </motion.div>
      ))}
      
      {/* Main character */}
      <motion.div
        className="relative bg-gradient-to-br from-red-100 to-pink-100 p-6 rounded-full shadow-lg z-10"
        animate={{
          scale: [1, 1.15, 1],
          boxShadow: [
            '0 4px 6px rgba(239, 68, 68, 0.2)',
            '0 10px 25px rgba(239, 68, 68, 0.4)',
            '0 4px 6px rgba(239, 68, 68, 0.2)'
          ]
        }}
        transition={{
          duration: 0.6,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        <motion.div
          animate={{
            rotate: [-15, 15, -15]
          }}
          transition={{
            duration: 0.3,
            repeat: Infinity,
            ease: "linear"
          }}
        >
          <Ban className="w-16 h-16 text-red-500" />
        </motion.div>
        
        {/* Face overlay */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{
            scale: [1, 1.2, 1]
          }}
          transition={{
            duration: 0.4,
            repeat: Infinity
          }}
        >
          <div className="relative top-1">
            <span className="text-3xl">😱</span>
          </div>
        </motion.div>
      </motion.div>
      
      {/* Floating warning signs */}
      <motion.div
        className="absolute -top-4 -right-4"
        animate={{
          rotate: [0, -10, 10, 0],
          scale: [1, 1.2, 1]
        }}
        transition={{
          duration: 0.5,
          repeat: Infinity
        }}
      >
        <AlertTriangle className="w-8 h-8 text-yellow-500 fill-yellow-100" />
      </motion.div>
    </div>
  )
}

// Funny messages for each animation
const animationMessages = [
  {
    title: "Oops! The Ghost Says No! 👻",
    subtitle: "Your wallet is feeling a bit... transparent!",
    tip: "Keep scanning to fill up those points!"
  },
  {
    title: "Where Did All the Coins Go? 🪙",
    subtitle: "Your piggy bank needs more snacks!",
    tip: "More scans = More rewards!"
  },
  {
    title: "ALERT! Points Emergency! 🚨",
    subtitle: "Houston, we have a points problem!",
    tip: "Quick! Scan more products to save the day!"
  }
]

export function InsufficientPointsAnimation({
  isOpen,
  pointsNeeded,
  pointsAvailable,
  onClose,
  primaryColor = '#3B82F6'
}: InsufficientPointsAnimationProps) {
  // Randomly select an animation when modal opens
  const [animationIndex, setAnimationIndex] = useState(0)
  
  useEffect(() => {
    if (isOpen) {
      setAnimationIndex(Math.floor(Math.random() * 3))
    }
  }, [isOpen])
  
  const animations = [
    <SadGhostAnimation key="ghost" />,
    <ConfusedCoinAnimation key="coins" />,
    <DramaticNoEntryAnimation key="noentry" />
  ]
  
  const currentMessage = animationMessages[animationIndex]
  const pointsShort = pointsNeeded - pointsAvailable

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl overflow-hidden"
            initial={{ scale: 0.8, y: 50, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 50, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
          >
            {/* Background decoration */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
              <motion.div
                className="absolute -top-20 -right-20 w-40 h-40 bg-red-100 rounded-full opacity-50"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
              <motion.div
                className="absolute -bottom-20 -left-20 w-40 h-40 bg-orange-100 rounded-full opacity-50"
                animate={{ scale: [1.2, 1, 1.2] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </div>

            {/* Content */}
            <div className="relative text-center space-y-5">
              {/* Animation character */}
              <div className="flex justify-center py-4">
                {animations[animationIndex]}
              </div>

              {/* Title & Message */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {currentMessage.title}
                </h3>
                <p className="text-gray-500 text-sm">
                  {currentMessage.subtitle}
                </p>
              </motion.div>

              {/* Points info */}
              <motion.div
                className="bg-gradient-to-r from-red-50 to-orange-50 rounded-2xl p-4 border border-red-100"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">You need:</span>
                  <span className="font-bold text-red-500">{pointsNeeded} pts</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-gray-600">You have:</span>
                  <span className="font-bold text-gray-900">{pointsAvailable} pts</span>
                </div>
                <div className="border-t border-red-200 my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">You're short:</span>
                  <motion.span
                    className="font-bold text-lg text-red-600"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, repeat: 3 }}
                  >
                    {pointsShort} pts
                  </motion.span>
                </div>
              </motion.div>

              {/* Tip */}
              <motion.p
                className="text-sm text-gray-500 flex items-center justify-center gap-2"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <span className="text-lg">💡</span>
                {currentMessage.tip}
              </motion.p>

              {/* Close button */}
              <motion.button
                onClick={onClose}
                className="w-full px-6 py-3 text-white font-semibold rounded-xl shadow-lg transition-all hover:shadow-xl"
                style={{ backgroundColor: primaryColor }}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Got it! I'll scan more! 🚀
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
