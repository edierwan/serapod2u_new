'use client'

import { useEffect, useRef, useState } from 'react'
import { Gift, Trophy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ScratchCardProps {
    primaryColor: string
    titleText: string
    successMessage: string
    noPrizeMessage: string
    result?: {
        isWin: boolean
        rewardName: string
    } | null
    onScratchComplete?: () => void
    isScratching?: boolean
    isPreview?: boolean
    theme?: 'default' | 'modern' | 'classic' | 'retro' | 'vip' | 'cyber'
}

export default function ScratchCard({
    primaryColor = '#3B82F6',
    titleText = 'Scratch & WIN',
    successMessage = 'You won: {{reward_name}}',
    noPrizeMessage = 'Better luck next time!',
    result,
    onScratchComplete,
    isScratching = false,
    isPreview = false,
    theme = 'default'
}: ScratchCardProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isRevealed, setIsRevealed] = useState(false)
    const [scratchPercent, setScratchPercent] = useState(0)

    // Theme styles
    const getThemeStyles = () => {
        switch (theme) {
            case 'modern':
                return {
                    container: 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white border-none shadow-2xl',
                    title: 'text-white drop-shadow-md',
                    scratchArea: 'bg-white/10 backdrop-blur-sm border-white/20',
                    footer: 'text-white/70'
                }
            case 'retro':
                return {
                    container: 'bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500 text-white border-4 border-yellow-300 shadow-2xl',
                    title: 'text-white drop-shadow-lg font-black tracking-widest',
                    scratchArea: 'bg-white/20 backdrop-blur-sm border-white/40 border-4 border-dashed',
                    footer: 'text-yellow-100'
                }
            case 'vip':
                return {
                    container: 'bg-gradient-to-br from-amber-600 via-yellow-500 to-amber-700 text-black border-4 border-yellow-400 shadow-2xl',
                    title: 'text-black drop-shadow-sm font-bold tracking-wide',
                    scratchArea: 'bg-black/20 backdrop-blur-sm border-yellow-400/60 border-2',
                    footer: 'text-black/70'
                }
            case 'cyber':
                return {
                    container: 'bg-gradient-to-br from-purple-900 via-indigo-800 to-blue-900 text-cyan-300 border-2 border-cyan-500 shadow-2xl shadow-cyan-500/20',
                    title: 'text-cyan-300 drop-shadow-[0_0_10px_rgba(0,255,255,0.5)] font-bold tracking-widest uppercase',
                    scratchArea: 'bg-cyan-500/10 backdrop-blur-sm border-cyan-500/40 border-2',
                    footer: 'text-cyan-400/70'
                }
            default:
                return {
                    container: 'bg-white border-4 border-white shadow-xl',
                    title: '', // Use inline style for color
                    scratchArea: 'bg-gray-50 border-gray-300',
                    footer: 'text-gray-400'
                }
        }
    }

    const styles = getThemeStyles()

    useEffect(() => {
        if (isPreview) return

        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Initialize canvas
        const initCanvas = () => {
            // Create gradient for scratch surface
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
            gradient.addColorStop(0, '#d1d5db')
            gradient.addColorStop(0.5, '#f3f4f6')
            gradient.addColorStop(1, '#9ca3af')
            
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            
            // Add some noise/texture
            for (let i = 0; i < 1000; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.1)'
                ctx.fillRect(
                    Math.random() * canvas.width,
                    Math.random() * canvas.height,
                    2, 2
                )
            }

            // Add "Scratch Here" text
            ctx.font = 'bold 24px sans-serif'
            ctx.fillStyle = '#4b5563'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            
            // Add shadow to text
            ctx.shadowColor = 'rgba(255,255,255,0.5)'
            ctx.shadowBlur = 2
            ctx.shadowOffsetX = 1
            ctx.shadowOffsetY = 1
            
            ctx.fillText('SCRATCH HERE', canvas.width / 2, canvas.height / 2)
            
            // Reset shadow
            ctx.shadowColor = 'transparent'
        }

        initCanvas()
    }, [isPreview])

    // Handle scratching
    useEffect(() => {
        if (isPreview || !canvasRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let isDrawing = false
        let lastX = 0
        let lastY = 0
        let hasTriggered = false

        const getPos = (e: MouseEvent | TouchEvent) => {
            const rect = canvas.getBoundingClientRect()
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            }
        }

        const startDrawing = (e: MouseEvent | TouchEvent) => {
            isDrawing = true
            const { x, y } = getPos(e)
            lastX = x
            lastY = y
        }

        const draw = (e: MouseEvent | TouchEvent) => {
            if (!isDrawing) return
            e.preventDefault() // Prevent scrolling on touch
            const { x, y } = getPos(e)
            
            ctx.globalCompositeOperation = 'destination-out'
            ctx.lineWidth = 40
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(lastX, lastY)
            ctx.lineTo(x, y)
            ctx.stroke()
            
            lastX = x
            lastY = y

            // Trigger completion once user starts scratching significantly
            if (!hasTriggered && onScratchComplete) {
                hasTriggered = true
                onScratchComplete()
            }
        }

        const stopDrawing = () => {
            isDrawing = false
        }

        canvas.addEventListener('mousedown', startDrawing)
        canvas.addEventListener('mousemove', draw)
        canvas.addEventListener('mouseup', stopDrawing)
        canvas.addEventListener('touchstart', startDrawing)
        canvas.addEventListener('touchmove', draw)
        canvas.addEventListener('touchend', stopDrawing)

        return () => {
            canvas.removeEventListener('mousedown', startDrawing)
            canvas.removeEventListener('mousemove', draw)
            canvas.removeEventListener('mouseup', stopDrawing)
            canvas.removeEventListener('touchstart', startDrawing)
            canvas.removeEventListener('touchmove', draw)
            canvas.removeEventListener('touchend', stopDrawing)
        }
    }, [isPreview, onScratchComplete])

    // Auto-reveal if result is present
    useEffect(() => {
        console.log('ScratchCard useEffect - result:', result, 'isRevealed:', isRevealed, 'isPreview:', isPreview)
        if (result && !isRevealed && !isPreview) {
             // If we have a result, we can fade out the canvas
             const canvas = canvasRef.current
             if (canvas) {
                 canvas.style.transition = 'opacity 0.7s ease-out'
                 canvas.style.opacity = '0'
                 setTimeout(() => {
                     setIsRevealed(true)
                     console.log('ScratchCard revealed!')
                 }, 700)
             } else {
                 // No canvas, reveal immediately
                 setIsRevealed(true)
             }
        }
    }, [result, isRevealed, isPreview])

    return (
        <div className={cn("relative w-full max-w-sm mx-auto aspect-[3/4] rounded-xl overflow-hidden", styles.container)}>
            {/* Background Pattern */}
            {theme === 'default' && (
                <div 
                    className="absolute inset-0 opacity-10"
                    style={{ 
                        backgroundImage: `radial-gradient(circle at 2px 2px, ${primaryColor} 1px, transparent 0)`,
                        backgroundSize: '20px 20px'
                    }}
                />
            )}

            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-6">
                {/* Header */}
                <div className="space-y-2 z-10">
                    <h3 
                        className={cn("text-2xl font-extrabold uppercase tracking-wider", styles.title)}
                        style={theme === 'default' ? { color: primaryColor } : {}}
                    >
                        {titleText}
                    </h3>
                    <div className={cn(
                        "h-1 w-20 mx-auto rounded-full",
                        theme === 'modern' && "bg-white/30",
                        theme === 'retro' && "bg-yellow-200/50",
                        theme === 'vip' && "bg-yellow-400/60",
                        theme === 'cyber' && "bg-cyan-500/40",
                        theme === 'default' && "bg-gray-200"
                    )} />
                </div>

                {/* Scratch Area Container */}
                <div className="relative w-64 h-64 flex-shrink-0 z-10">
                    {/* Reward Layer (Bottom) */}
                    <div className={cn("absolute inset-0 rounded-xl border-2 border-dashed flex items-center justify-center p-4 overflow-hidden", styles.scratchArea)}>
                        {result ? (
                            <div className="space-y-3 animate-in zoom-in duration-500">
                                {result.isWin ? (
                                    <>
                                        <Trophy className={cn(
                                            "w-16 h-16 mx-auto animate-bounce",
                                            theme === 'modern' && "text-yellow-300",
                                            theme === 'retro' && "text-yellow-200",
                                            theme === 'vip' && "text-yellow-600",
                                            theme === 'cyber' && "text-cyan-300",
                                            theme === 'default' && "text-yellow-500"
                                        )} />
                                        <div>
                                            <p className={cn(
                                                "font-bold text-lg",
                                                theme === 'modern' && "text-white",
                                                theme === 'retro' && "text-white",
                                                theme === 'vip' && "text-black",
                                                theme === 'cyber' && "text-cyan-300",
                                                theme === 'default' && "text-gray-900"
                                            )}>
                                                {successMessage.replace('{{reward_name}}', result.rewardName)}
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className={cn(
                                            "w-16 h-16 mx-auto rounded-full flex items-center justify-center",
                                            theme === 'modern' && "bg-white/20",
                                            theme === 'retro' && "bg-white/30",
                                            theme === 'vip' && "bg-black/20",
                                            theme === 'cyber' && "bg-cyan-500/20",
                                            theme === 'default' && "bg-gray-200"
                                        )}>
                                            <span className="text-2xl">😔</span>
                                        </div>
                                        <p className={cn(
                                            "font-medium",
                                            theme === 'modern' && "text-white/80",
                                            theme === 'retro' && "text-white/90",
                                            theme === 'vip' && "text-black/70",
                                            theme === 'cyber' && "text-cyan-400/80",
                                            theme === 'default' && "text-gray-600"
                                        )}>{noPrizeMessage}</p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className={cn(
                                "font-medium text-sm",
                                theme === 'modern' && "text-white/50",
                                theme === 'retro' && "text-white/60",
                                theme === 'vip' && "text-black/50",
                                theme === 'cyber' && "text-cyan-500/50",
                                theme === 'default' && "text-gray-400"
                            )}>
                                Prize hidden here
                            </div>
                        )}
                    </div>

                    {/* Scratch Layer (Top) */}
                    {!isRevealed && (
                        <div className={cn(
                            "absolute inset-0 rounded-xl overflow-hidden transition-opacity duration-700",
                            result && isScratching ? "cursor-pointer" : "" 
                        )}>
                            {isPreview ? (
                                <div className="w-full h-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center relative">
                                    <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]"></div>
                                    <span className="font-bold text-gray-600 text-xl drop-shadow-md">SCRATCH HERE</span>
                                    <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                                </div>
                            ) : (
                                <canvas
                                    ref={canvasRef}
                                    width={256}
                                    height={256}
                                    className="w-full h-full touch-none"
                                    // We remove onClick here because we handle it via event listeners
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={cn("text-xs z-10", styles.footer)}>
                    Scratch the silver area to reveal your prize!
                </div>
            </div>
        </div>
    )
}
