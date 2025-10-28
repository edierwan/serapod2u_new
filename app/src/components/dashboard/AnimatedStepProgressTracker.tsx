'use client'

import { useMemo, useState, useEffect } from 'react'
import { AlertCircle, Factory, Warehouse, Truck, Store } from 'lucide-react'

interface StepData {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  percent: number
  color: string
  bgColor: string
  borderColor: string
}

interface AnimatedStepProgressTrackerProps {
  steps: StepData[]
  totalCases: number
}

export default function AnimatedStepProgressTracker({
  steps,
  totalCases
}: AnimatedStepProgressTrackerProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [animatingSteps, setAnimatingSteps] = useState<boolean[]>([])

  // Trigger load animation on mount
  useEffect(() => {
    setIsLoaded(true)
    // Stagger animation for each step
    steps.forEach((_, index) => {
      setTimeout(() => {
        setAnimatingSteps(prev => {
          const updated = [...prev]
          updated[index] = true
          return updated
        })
      }, index * 120)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length])

  // Calculate completion percentages for each step
  const stepsWithCompletion = useMemo(() => {
    return steps.map((step, index) => ({
      ...step,
      isCompleted: step.count > 0,
      isCurrentStep: index === steps.findIndex(s => s.count > 0),
      stepIndex: index,
      totalSteps: steps.length
    }))
  }, [steps])

  // Find the furthest completed step
  const maxCompletedStep = useMemo(() => {
    const completed = stepsWithCompletion.filter(s => s.isCompleted)
    return completed.length > 0 ? completed[completed.length - 1].stepIndex : -1
  }, [stepsWithCompletion])

  // Calculate actual progress based on weighted completion
  const actualProgress = useMemo(() => {
    if (totalCases === 0) return 0
    const totalPercent = steps.reduce((sum, step) => sum + step.percent, 0)
    return Math.round((totalPercent / steps.length) * 10) / 10
  }, [steps, totalCases])

  const iconMap = {
    'AlertCircle': AlertCircle,
    'Factory': Factory,
    'Warehouse': Warehouse,
    'Truck': Truck,
    'Store': Store
  }

  return (
    <div className="w-full">
  <div className="space-y-7">
        {/* Enhanced Step Progress Tracker with VISIBLE Animations */}
        <div className="relative">
          {/* Step circles and connecting lines */}
          <div className="flex items-center justify-between mb-8">
            {stepsWithCompletion.map((step, idx) => {
              const isCompleted = maxCompletedStep >= idx
              const Icon = step.icon
              const isActive = step.isCurrentStep && !isCompleted
              const isAnimating = animatingSteps[idx]

              return (
                <div
                  key={step.key}
                  className="flex items-center"
                  style={{
                    flex: idx < stepsWithCompletion.length - 1 ? '1' : '0 0 auto',
                  }}
                >
                  {/* Step circle container - CENTERED */}
                  <div className="relative flex flex-col items-center justify-center">
                    <div
                      className={`relative flex items-center justify-center w-16 h-16 rounded-full border-3 transition-all duration-500 ${
                        isCompleted
                          ? 'bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 border-emerald-700 text-white shadow-xl'
                          : isActive
                          ? 'bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 border-blue-700 text-white shadow-xl'
                          : 'bg-white border-gray-300 text-gray-400 shadow-sm'
                      }`}
                      style={{
                        animation: isAnimating 
                          ? `${isCompleted ? 'popInComplete' : isActive ? 'popInActive' : 'popIn'} 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) ${idx * 0.15}s both` 
                          : 'none',
                        transform: isActive ? 'scale(1)' : 'scale(1)',
                      }}
                    >
                      {/* Icon - PERFECTLY CENTERED */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {isCompleted && (
                          <svg
                            className="w-5.5 h-5.5 text-white"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              animation: 'checkmarkDrop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both'
                            }}
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {!isCompleted && (
                          <Icon className="w-5 h-5" />
                        )}
                      </div>

                      {/* VISIBLE animated glow for active step */}
                      {isActive && (
                        <>
                          <div 
                            className="absolute inset-0 rounded-full border-3 border-blue-300"
                            style={{
                              animation: 'activePulse 2s ease-in-out infinite',
                            }}
                          />
                          <div 
                            className="absolute inset-0 rounded-full border-2 border-blue-200"
                            style={{
                              animation: 'activeRing 2s ease-in-out infinite 0.5s',
                            }}
                          />
                          <div 
                            className="absolute inset-0 rounded-full"
                            style={{
                              animation: 'activeShadow 2s ease-in-out infinite',
                              boxShadow: '0 0 18px rgba(59, 130, 246, 0.55)'
                            }}
                          />
                        </>
                      )}

                      {/* VISIBLE completion glow */}
                      {isCompleted && (
                        <div 
                          className="absolute inset-0 rounded-full"
                          style={{
                            animation: 'completionBurst 1s ease-out 0.4s both',
                            boxShadow: '0 0 24px rgba(16, 185, 129, 0.7)'
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Connecting line with VISIBLE animation */}
                  {idx < stepsWithCompletion.length - 1 && (
                    <div className="flex-1 h-2.5 mx-4 relative overflow-hidden rounded-full">
                      {/* Background line */}
                      <div className="absolute inset-0 bg-gray-200 rounded-full" />
                      
                      {/* Animated fill line - VERY VISIBLE */}
                      <div
                        className={`absolute inset-0 rounded-full transition-all duration-1000 ${
                          isCompleted 
                            ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 shadow-lg' 
                            : 'bg-blue-400 w-0'
                        }`}
                        style={{
                          animation: isCompleted && isAnimating 
                            ? `lineSlide 1s ease-out ${0.4 + idx * 0.15}s both, lineGlow 2s ease-in-out ${0.5 + idx * 0.15}s infinite` 
                            : 'none',
                          width: isCompleted ? '100%' : '0%'
                        }}
                      >
                        {/* Moving shimmer effect - VISIBLE */}
                        {isCompleted && (
                          <div 
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-40"
                            style={{
                              animation: 'lineShimmer 2s linear infinite'
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Step labels, counts, and percentages - PERFECTLY CENTERED */}
          <div className="flex items-start justify-between">
            {stepsWithCompletion.map((step, idx) => {
              const isAnimating = animatingSteps[idx]
              const isCompleted = maxCompletedStep >= idx
              const isActive = step.isCurrentStep && !isCompleted
              
              return (
                <div
                  key={`label-${step.key}`}
                  className="flex flex-col items-center justify-center text-center"
                  style={{
                    flex: idx < stepsWithCompletion.length - 1 ? '1' : '0 0 140px',
                    animation: isAnimating ? `labelSlideUp 0.6s ease-out ${idx * 0.15 + 0.2}s both` : 'none'
                  }}
                >
                  {/* Label - CENTERED */}
                  <p className={`text-xs font-semibold leading-tight mb-2 px-2 transition-all duration-300 ${
                    isCompleted 
                      ? 'text-emerald-700' 
                      : isActive 
                      ? 'text-blue-700' 
                      : 'text-gray-600'
                  }`}>
                    {step.label}
                  </p>
                  
                  {/* Count - CENTERED with VISIBLE animation */}
                  <div 
                    className={`text-3xl font-bold mb-1 transition-all duration-300 ${
                      isCompleted
                        ? 'text-emerald-600'
                        : isActive
                        ? 'text-blue-600'
                        : 'text-gray-400'
                    }`}
                    style={{
                      animation: isCompleted && isAnimating 
                        ? 'countBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both' 
                        : isActive && isAnimating
                        ? 'countPulse 2s ease-in-out infinite'
                        : 'none',
                      textShadow: isCompleted 
                        ? '0 2px 8px rgba(16, 185, 129, 0.3)' 
                        : isActive
                        ? '0 2px 8px rgba(59, 130, 246, 0.3)'
                        : 'none'
                    }}
                  >
                    {step.count}
                  </div>
                  
                  {/* Percentage badge - CENTERED */}
                  <div 
                    className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold border transition-all duration-300 ${
                      isCompleted
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 shadow-md'
                        : isActive
                        ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-md'
                        : 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}
                    style={{
                      animation: isActive ? 'badgePulse 2s ease-in-out infinite' : 'none'
                    }}
                  >
                    {step.percent}%
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Enhanced Progress Bar Section - VISIBLE */}
        <div className="pt-5 border-t border-gray-300">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span 
                className="w-2.5 h-2.5 bg-emerald-500 rounded-full"
                style={{
                  animation: 'dotBounce 1.5s ease-in-out infinite'
                }}
              ></span>
              Pipeline Progression
            </p>
            <div className="flex items-center gap-3">
              <p className="text-xl font-bold text-emerald-600">
                {actualProgress}%
              </p>
              <span className="text-xs font-medium text-gray-600">Complete</span>
            </div>
          </div>
          
          {/* Enhanced progress bar with VERY VISIBLE animation */}
          <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-visible shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-emerald-600 rounded-full relative overflow-hidden"
              style={{
                width: `${actualProgress}%`,
                animation: isLoaded ? `progressFill 1.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.8s both, progressGlow 3s ease-in-out 1.6s infinite` : 'none',
                boxShadow: '0 0 14px rgba(16, 185, 129, 0.45), inset 0 0 8px rgba(255, 255, 255, 0.25)'
              }}
            >
              {/* VISIBLE shimmer effect */}
              <div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-35"
                style={{
                  animation: 'progressShimmer 2s linear infinite 1s'
                }}
              />
              
              {/* Progress waves */}
              <div 
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                  animation: 'progressWave 3s ease-in-out infinite'
                }}
              />
            </div>
            
            {/* VISIBLE progress indicator dot */}
            {actualProgress > 0 && (
              <div 
                className="absolute top-1/2 w-6 h-6 bg-white border-4 border-emerald-600 rounded-full shadow-xl"
                style={{
                  left: `calc(${actualProgress}% - 12px)`,
                  transform: 'translateY(-50%)',
                  animation: 'dotBounce 1.5s ease-in-out infinite, dotGlow 2s ease-in-out infinite',
                  boxShadow: '0 0 20px rgba(16, 185, 129, 0.8), 0 4px 8px rgba(0, 0, 0, 0.2)'
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* HIGHLY VISIBLE Keyframe Animations */}
      <style jsx>{`
        /* Pop-in animations - VERY VISIBLE */
        @keyframes popIn {
          0% {
            opacity: 0;
            transform: scale(0) translateY(50px) rotate(180deg);
          }
          60% {
            transform: scale(1.3) translateY(-10px) rotate(-10deg);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0) rotate(0deg);
          }
        }

        @keyframes popInComplete {
          0% {
            opacity: 0;
            transform: scale(0) translateY(50px);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
          50% {
            transform: scale(1.4) translateY(-15px);
            box-shadow: 0 0 40px 20px rgba(16, 185, 129, 0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
            box-shadow: 0 0 30px 10px rgba(16, 185, 129, 0.4);
          }
        }

        @keyframes popInActive {
          0% {
            opacity: 0;
            transform: scale(0) translateY(50px);
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
          }
          50% {
            transform: scale(1.4) translateY(-15px);
            box-shadow: 0 0 40px 20px rgba(59, 130, 246, 0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
            box-shadow: 0 0 30px 10px rgba(59, 130, 246, 0.4);
          }
        }

        /* Checkmark drop - VERY DRAMATIC */
        @keyframes checkmarkDrop {
          0% {
            opacity: 0;
            transform: translateY(-100px) scale(0) rotate(-180deg);
          }
          50% {
            opacity: 1;
            transform: translateY(10px) scale(1.5) rotate(10deg);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1) rotate(0deg);
          }
        }

        /* Active step pulse - HIGHLY VISIBLE */
        @keyframes activePulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.3;
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.8);
          }
          50% {
            transform: scale(1.5);
            opacity: 0;
            box-shadow: 0 0 0 20px rgba(59, 130, 246, 0);
          }
        }

        @keyframes activeRing {
          0%, 100% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.7);
            opacity: 0;
          }
        }

        @keyframes activeShadow {
          0%, 100% {
            box-shadow: 0 0 30px rgba(59, 130, 246, 0.8);
          }
          50% {
            box-shadow: 0 0 60px rgba(59, 130, 246, 1);
          }
        }

        /* Completion burst - EXPLOSIVE */
        @keyframes completionBurst {
          0% {
            opacity: 0;
            transform: scale(0.5);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 1);
          }
          50% {
            opacity: 1;
            transform: scale(2);
            box-shadow: 0 0 80px 40px rgba(16, 185, 129, 0.8);
          }
          100% {
            opacity: 0;
            transform: scale(3);
            box-shadow: 0 0 100px 50px rgba(16, 185, 129, 0);
          }
        }

        /* Line animations - VERY VISIBLE */
        @keyframes lineSlide {
          from {
            width: 0;
            opacity: 0;
            transform: scaleX(0);
            transform-origin: left;
          }
          to {
            width: 100%;
            opacity: 1;
            transform: scaleX(1);
          }
        }

        @keyframes lineGlow {
          0%, 100% {
            box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
          }
          50% {
            box-shadow: 0 0 30px rgba(16, 185, 129, 1);
          }
        }

        @keyframes lineShimmer {
          0% {
            transform: translateX(-100%) skewX(-20deg);
          }
          100% {
            transform: translateX(300%) skewX(-20deg);
          }
        }

        /* Label slide up - VISIBLE */
        @keyframes labelSlideUp {
          from {
            opacity: 0;
            transform: translateY(40px) scale(0.8);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* Count animations - VERY DRAMATIC */
        @keyframes countBounce {
          0% {
            opacity: 0;
            transform: scale(0) translateY(50px);
          }
          50% {
            opacity: 1;
            transform: scale(1.8) translateY(-20px);
          }
          70% {
            transform: scale(0.9) translateY(5px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes countPulse {
          0%, 100% {
            transform: scale(1);
            text-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
          }
          50% {
            transform: scale(1.3);
            text-shadow: 0 4px 20px rgba(59, 130, 246, 0.8);
          }
        }

        /* Badge pulse - VISIBLE */
        @keyframes badgePulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5);
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
          }
        }

        /* Progress bar animations - HIGHLY VISIBLE */
        @keyframes progressFill {
          0% {
            width: 0;
            opacity: 0;
            transform: scaleX(0);
            transform-origin: left;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 1;
            transform: scaleX(1);
          }
        }

        @keyframes progressGlow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.6), inset 0 0 10px rgba(255, 255, 255, 0.3);
          }
          50% {
            box-shadow: 0 0 40px rgba(16, 185, 129, 1), inset 0 0 20px rgba(255, 255, 255, 0.5);
          }
        }

        @keyframes progressShimmer {
          0% {
            transform: translateX(-100%) skewX(-15deg);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateX(200%) skewX(-15deg);
            opacity: 0;
          }
        }

        @keyframes progressWave {
          0%, 100% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(100%);
          }
        }

        /* Dot animations - VERY VISIBLE */
        @keyframes dotBounce {
          0%, 100% {
            transform: translateY(-50%) scale(1);
          }
          50% {
            transform: translateY(-70%) scale(1.4);
          }
        }

        @keyframes dotGlow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.8), 0 4px 8px rgba(0, 0, 0, 0.2);
          }
          50% {
            box-shadow: 0 0 40px rgba(16, 185, 129, 1), 0 8px 16px rgba(0, 0, 0, 0.3);
          }
        }
      `}</style>
    </div>
  )
}
