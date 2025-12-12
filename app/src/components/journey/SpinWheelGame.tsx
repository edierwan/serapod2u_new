'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Gift, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpinWheelGameProps {
    primaryColor: string
    onSpinComplete?: () => void
    isSpinning?: boolean
    result?: {
        isWin: boolean
        rewardName: string
    } | null
}

export default function SpinWheelGame({
    primaryColor = '#3B82F6',
    onSpinComplete,
    isSpinning = false,
    result
}: SpinWheelGameProps) {
    const [rotation, setRotation] = useState(0)
    const [spinning, setSpinning] = useState(false)

    const handleSpin = () => {
        if (spinning || isSpinning) return
        
        setSpinning(true)
        // Random rotation between 5 and 10 full spins + random angle
        const newRotation = rotation + 1800 + Math.random() * 360
        setRotation(newRotation)

        setTimeout(() => {
            setSpinning(false)
            if (onSpinComplete) onSpinComplete()
        }, 5000)
    }

    return (
        <div className="flex flex-col items-center justify-center p-6 bg-white rounded-xl shadow-lg">
            <div className="relative w-64 h-64 mb-8">
                {/* Wheel */}
                <div 
                    className="w-full h-full rounded-full border-4 border-gray-200 overflow-hidden transition-transform duration-[5000ms] cubic-bezier(0.2, 0.8, 0.2, 1)"
                    style={{ 
                        transform: `rotate(${rotation}deg)`,
                        background: `conic-gradient(
                            ${primaryColor} 0deg 60deg, 
                            #f3f4f6 60deg 120deg, 
                            ${primaryColor} 120deg 180deg, 
                            #f3f4f6 180deg 240deg, 
                            ${primaryColor} 240deg 300deg, 
                            #f3f4f6 300deg 360deg
                        )`
                    }}
                >
                    {/* Segments would go here */}
                </div>
                
                {/* Pointer */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-4 h-8 bg-red-500 z-10" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                
                {/* Center Button */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-white rounded-full shadow-md flex items-center justify-center z-20">
                    <span className="font-bold text-gray-800">SPIN</span>
                </div>
            </div>

            {result ? (
                <div className="text-center animate-in fade-in zoom-in duration-500">
                    <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trophy className="w-8 h-8 text-yellow-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                        {result.isWin ? 'Congratulations!' : 'Try Again!'}
                    </h3>
                    <p className="text-gray-600 mb-6">
                        {result.isWin ? `You won: ${result.rewardName}` : 'Better luck next time!'}
                    </p>
                </div>
            ) : (
                <Button 
                    onClick={handleSpin} 
                    disabled={spinning || isSpinning}
                    className="w-full h-12 text-lg font-bold shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
                    style={{ backgroundColor: primaryColor }}
                >
                    {spinning ? 'Spinning...' : 'Spin Now!'}
                </Button>
            )}
        </div>
    )
}
