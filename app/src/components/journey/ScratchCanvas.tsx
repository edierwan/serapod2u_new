'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ScratchCanvasProps {
    onScratchComplete?: () => void
    isRevealed?: boolean
    brushSize?: number
    scratchPercentThreshold?: number
    className?: string
    overlayColor?: string
    overlayGradient?: string // CSS gradient string
    children: React.ReactNode
    onScratchStart?: () => void
}

export default function ScratchCanvas({
    onScratchComplete,
    isRevealed = false,
    brushSize = 30,
    scratchPercentThreshold = 50,
    className,
    overlayColor = '#d1d5db',
    overlayGradient,
    children,
    onScratchStart
}: ScratchCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isScratching, setIsScratching] = useState(false)
    const [isCanvasReady, setIsCanvasReady] = useState(false)

    // Initialize canvas
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Set canvas size to match parent
        const parent = canvas.parentElement
        if (parent) {
            canvas.width = parent.clientWidth
            canvas.height = parent.clientHeight
        }

        // Draw overlay
        if (overlayGradient) {
            // Create gradient
            // Since we can't easily parse CSS gradient to Canvas gradient, 
            // we'll use a simple approximation or just fill with color if gradient fails.
            // Actually, for simplicity in this component, we might just use a solid color 
            // or let the user pass a draw function. 
            // But to support the existing gradients, we can try to fillRect with a color 
            // or use a pattern.
            
            // For now, let's just use the overlayColor or a default gray.
            // If we want the fancy gradients from the parent, we might need to 
            // draw them on the canvas.
            
            // A better approach for complex CSS backgrounds is to have a DIV with the background
            // and the canvas just handles the "erasing" by using destination-out.
            // BUT, to erase the background, the background MUST be on the canvas.
            
            // So, we will try to draw a simple gradient or color.
            const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
            grd.addColorStop(0, '#d1d5db')
            grd.addColorStop(0.5, '#f3f4f6')
            grd.addColorStop(1, '#9ca3af')
            ctx.fillStyle = grd
        } else {
            ctx.fillStyle = overlayColor
        }
        
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        // Add "SCRATCH HERE" text
        ctx.font = 'bold 24px sans-serif'
        ctx.fillStyle = '#6b7280'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('SCRATCH HERE', canvas.width / 2, canvas.height / 2)
        
        // Add some noise
        for (let i = 0; i < 200; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000'
            ctx.globalAlpha = 0.1
            ctx.fillRect(
                Math.random() * canvas.width,
                Math.random() * canvas.height,
                2, 2
            )
        }
        ctx.globalAlpha = 1.0

        setIsCanvasReady(true)
    }, [overlayColor, overlayGradient])

    // Handle scratching
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !isCanvasReady) return

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

        const checkScratchPercent = () => {
            if (isRevealed) return

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const pixels = imageData.data
            let transparentPixels = 0
            
            // Check every 4th pixel to save performance
            for (let i = 0; i < pixels.length; i += 4 * 4) {
                if (pixels[i + 3] < 128) {
                    transparentPixels++
                }
            }
            
            const totalPixels = (canvas.width * canvas.height) / 4
            const percent = (transparentPixels / totalPixels) * 100
            
            if (percent > scratchPercentThreshold) {
                if (onScratchComplete) onScratchComplete()
            }
        }

        const startDrawing = (e: MouseEvent | TouchEvent) => {
            isDrawing = true
            const { x, y } = getPos(e)
            lastX = x
            lastY = y
            if (onScratchStart) onScratchStart()
        }

        const draw = (e: MouseEvent | TouchEvent) => {
            if (!isDrawing) return
            e.preventDefault()
            
            const { x, y } = getPos(e)
            
            ctx.globalCompositeOperation = 'destination-out'
            ctx.lineWidth = brushSize
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(lastX, lastY)
            ctx.lineTo(x, y)
            ctx.stroke()
            
            lastX = x
            lastY = y
        }

        const stopDrawing = () => {
            if (isDrawing) {
                isDrawing = false
                checkScratchPercent()
            }
        }

        canvas.addEventListener('mousedown', startDrawing)
        canvas.addEventListener('mousemove', draw)
        canvas.addEventListener('mouseup', stopDrawing)
        canvas.addEventListener('mouseleave', stopDrawing)
        canvas.addEventListener('touchstart', startDrawing)
        canvas.addEventListener('touchmove', draw)
        canvas.addEventListener('touchend', stopDrawing)

        return () => {
            canvas.removeEventListener('mousedown', startDrawing)
            canvas.removeEventListener('mousemove', draw)
            canvas.removeEventListener('mouseup', stopDrawing)
            canvas.removeEventListener('mouseleave', stopDrawing)
            canvas.removeEventListener('touchstart', startDrawing)
            canvas.removeEventListener('touchmove', draw)
            canvas.removeEventListener('touchend', stopDrawing)
        }
    }, [isCanvasReady, brushSize, scratchPercentThreshold, onScratchComplete, onScratchStart, isRevealed])

    return (
        <div className={cn("relative w-full h-full overflow-hidden", className)}>
            {/* Content Layer (Bottom) */}
            <div className="absolute inset-0 z-0 flex items-center justify-center">
                {children}
            </div>
            
            {/* Canvas Layer (Top) */}
            <canvas
                ref={canvasRef}
                className={cn(
                    "absolute inset-0 z-10 touch-none transition-opacity duration-700",
                    isRevealed ? "opacity-0 pointer-events-none" : "opacity-100"
                )}
            />
        </div>
    )
}
