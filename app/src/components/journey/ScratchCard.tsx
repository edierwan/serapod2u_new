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
}

export default function ScratchCard({
    primaryColor = '#3B82F6',
    titleText = 'Scratch & WIN',
    successMessage = 'You won: {{reward_name}}',
    noPrizeMessage = 'Better luck next time!',
    result,
    onScratchComplete,
    isScratching = false,
    isPreview = false
}: ScratchCardProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isRevealed, setIsRevealed] = useState(false)
    const [scratchPercent, setScratchPercent] = useState(0)

    useEffect(() => {
        if (isPreview) return

        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Initialize canvas
        const initCanvas = () => {
            ctx.fillStyle = '#d1d5db' // Silver/Gray
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            
            // Add some noise/texture
            for (let i = 0; i < 500; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? '#e5e7eb' : '#9ca3af'
                ctx.fillRect(
                    Math.random() * canvas.width,
                    Math.random() * canvas.height,
                    2, 2
                )
            }

            // Add "Scratch Here" text
            ctx.font = 'bold 20px sans-serif'
            ctx.fillStyle = '#6b7280'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('SCRATCH HERE', canvas.width / 2, canvas.height / 2)
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

        const getPos = (e: MouseEvent | TouchEvent) => {
            const rect = canvas.getBoundingClientRect()
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            }
        }

        const scratch = (x: number, y: number) => {
            ctx.globalCompositeOperation = 'destination-out'
            ctx.beginPath()
            ctx.arc(x, y, 20, 0, Math.PI * 2)
            ctx.fill()
            
            // Calculate scratched percentage
            // This is expensive, so maybe throttle or check less frequently
            // For now, we'll just use a simple counter or rely on the parent to trigger "reveal"
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
            ctx.beginPath()
            ctx.moveTo(lastX, lastY)
            ctx.lineTo(x, y)
            ctx.stroke()
            
            lastX = x
            lastY = y

            // Simple check: if user scratches enough, trigger complete
            // In a real app, we'd count pixels. Here we'll just use a timeout in the parent
            // or let the user scratch as much as they want until the API returns
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
    }, [isPreview])

    // If result is available and we are "scratching" (waiting for API), 
    // or if it's already revealed, we might want to clear the canvas automatically
    useEffect(() => {
        if (result && !isRevealed && !isPreview) {
            // If we have a result, we can let the user scratch to reveal it.
            // Or we can auto-reveal after some time.
            // For this UI, we assume the parent handles the "isScratching" state 
            // which might mean "waiting for API".
            // Once API returns, 'result' is populated.
        }
    }, [result, isRevealed, isPreview])

    return (
        <div className="relative w-full max-w-sm mx-auto aspect-[3/4] bg-white rounded-xl overflow-hidden shadow-xl border-4 border-white">
            {/* Background Pattern */}
            <div 
                className="absolute inset-0 opacity-10"
                style={{ 
                    backgroundImage: `radial-gradient(circle at 2px 2px, ${primaryColor} 1px, transparent 0)`,
                    backgroundSize: '20px 20px'
                }}
            />

            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-6">
                {/* Header */}
                <div className="space-y-2">
                    <h3 
                        className="text-2xl font-extrabold uppercase tracking-wider drop-shadow-sm"
                        style={{ color: primaryColor }}
                    >
                        {titleText}
                    </h3>
                    <div className="h-1 w-20 mx-auto rounded-full bg-gray-200" />
                </div>

                {/* Scratch Area Container */}
                <div className="relative w-64 h-64 flex-shrink-0">
                    {/* Reward Layer (Bottom) */}
                    <div className="absolute inset-0 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center p-4 overflow-hidden">
                        {result ? (
                            <div className="space-y-3 animate-in zoom-in duration-500">
                                {result.isWin ? (
                                    <>
                                        <Trophy className="w-16 h-16 mx-auto text-yellow-500 animate-bounce" />
                                        <div>
                                            <p className="font-bold text-lg text-gray-900">
                                                {successMessage.replace('{{reward_name}}', result.rewardName)}
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-16 h-16 mx-auto bg-gray-200 rounded-full flex items-center justify-center">
                                            <span className="text-2xl">😔</span>
                                        </div>
                                        <p className="font-medium text-gray-600">{noPrizeMessage}</p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="text-gray-400 font-medium text-sm">
                                Prize hidden here
                            </div>
                        )}
                    </div>

                    {/* Scratch Layer (Top) */}
                    {!isRevealed && (
                        <div className={cn(
                            "absolute inset-0 rounded-xl overflow-hidden transition-opacity duration-700",
                            result && isScratching ? "cursor-pointer" : "" // Logic handled by parent mostly
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
                                    onClick={onScratchComplete} // Fallback for simple click
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="text-xs text-gray-400">
                    Scratch the silver area to reveal your prize!
                </div>
            </div>
        </div>
    )
}
