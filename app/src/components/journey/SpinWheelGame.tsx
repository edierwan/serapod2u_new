'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Gift, Trophy, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

// Dynamically import Wheel to avoid SSR issues with canvas
const Wheel = dynamic(
  () => import('react-custom-roulette').then((mod) => mod.Wheel),
  { ssr: false }
)

const TEMPLATE_STYLES: Record<string, any> = {
    default: {
        colors: [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
            '#F7DC6F', '#BB8FCE', '#F1948A', '#82E0AA', '#F5B041'
        ],
        outerBorderColor: '#f3f4f6',
        outerBorderWidth: 5,
        innerBorderColor: '#f3f4f6',
        innerRadius: 20,
        radiusLineColor: '#f3f4f6',
        radiusLineWidth: 1,
        textColor: '#ffffff'
    },
    casino: {
        colors: [
            '#8B0000', // Dark Red
            '#006400', // Dark Green
            '#4B0082', // Indigo
            '#00008B', // Dark Blue
            '#8B4500', // Saddle Brown
            '#B8860B'  // Dark Goldenrod
        ],
        outerBorderColor: '#1a1a1a',
        outerBorderWidth: 12,
        innerBorderColor: '#1a1a1a',
        innerRadius: 15,
        radiusLineColor: '#000000',
        radiusLineWidth: 2,
        textColor: '#ffffff'
    },
    cartoon_royal: {
        colors: ['#8E44AD', '#F39C12', '#8E44AD', '#F39C12', '#8E44AD', '#F39C12'],
        outerBorderColor: '#F1C40F',
        outerBorderWidth: 8,
        innerBorderColor: '#F1C40F',
        innerRadius: 0,
        radiusLineColor: '#F1C40F',
        radiusLineWidth: 2,
        textColor: '#ffffff',
        centerImage: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Felix',
        buttonStyle: {
            background: 'linear-gradient(to bottom, #9B59B6, #8E44AD)',
            border: '4px solid #F1C40F',
            color: '#F1C40F',
            textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
            boxShadow: '0 4px 0 #6C3483, 0 5px 10px rgba(0,0,0,0.3)'
        }
    }
}

interface SpinWheelGameProps {
    primaryColor: string
    journeyId?: string
    qrCode?: string
    onSpinComplete?: () => void
}

export default function SpinWheelGame({
    primaryColor = '#3B82F6',
    journeyId,
    qrCode,
    onSpinComplete
}: SpinWheelGameProps) {
    const [loading, setLoading] = useState(true)
    const [campaign, setCampaign] = useState<any>(null)
    const [rewards, setRewards] = useState<any[]>([])
    const [mustSpin, setMustSpin] = useState(false)
    const [prizeNumber, setPrizeNumber] = useState(0)
    const [spinning, setSpinning] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const { toast } = useToast()
    const supabase = createClient()
    
    // Audio refs
    const spinAudioRef = useRef<HTMLAudioElement | null>(null)
    const winAudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        // Initialize audio
        spinAudioRef.current = new Audio('/sounds/spin-wheel.mp3')
        spinAudioRef.current.loop = true
        spinAudioRef.current.volume = 0.4
        
        winAudioRef.current = new Audio('/sounds/win.mp3')
        winAudioRef.current.volume = 0.5

        if (journeyId) {
            fetchCampaign()
        }
        
        return () => {
            // Cleanup audio
            if (spinAudioRef.current) {
                spinAudioRef.current.pause()
                spinAudioRef.current = null
            }
            if (winAudioRef.current) {
                winAudioRef.current.pause()
                winAudioRef.current = null
            }
        }
    }, [journeyId])

    const fetchCampaign = async () => {
        try {
            // Find active campaign for this journey
            const { data: campaigns, error: campError } = await supabase
                .from('spin_wheel_campaigns')
                .select('*')
                .eq('journey_config_id', journeyId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)

            if (campError) throw campError
            
            if (!campaigns || campaigns.length === 0) {
                setLoading(false)
                return
            }

            const activeCampaign = campaigns[0]
            setCampaign(activeCampaign)

            // Fetch rewards
            const { data: rewardsData, error: rewError } = await supabase
                .from('spin_wheel_rewards')
                .select('*')
                .eq('campaign_id', activeCampaign.id)
                .eq('is_active', true)
            
            if (rewError) throw rewError

            if (rewardsData) {
                setRewards(rewardsData)
            }
        } catch (err) {
            console.error('Error loading spin wheel:', err)
            setError('Failed to load game')
        } finally {
            setLoading(false)
        }
    }

    const handleSpinClick = async () => {
        if (spinning || mustSpin || !campaign) return

        setSpinning(true)
        setError(null)

        try {
            // Call API to get result
            const response = await fetch('/api/games/spin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaign_id: campaign.id,
                    qr_code: qrCode
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to spin')
            }

            if (data.success && data.reward) {
                // Find index of reward
                const index = rewards.findIndex(r => r.id === data.reward.id)
                if (index !== -1) {
                    setPrizeNumber(index)
                    setMustSpin(true)
                    setResult(data.reward)
                    
                    // Play spin sound
                    if (spinAudioRef.current) {
                        spinAudioRef.current.currentTime = 0
                        spinAudioRef.current.play().catch(e => console.log('Audio play failed', e))
                    }
                } else {
                    // Fallback if reward not found in local list (shouldn't happen)
                    throw new Error('Invalid reward configuration')
                }
            }
        } catch (err: any) {
            console.error('Spin error:', err)
            setError(err.message || 'Something went wrong. Please try again.')
            setSpinning(false)
            toast({
                title: "Error",
                description: err.message || "Failed to spin the wheel",
                variant: "destructive"
            })
        }
    }

    const handleStopSpinning = () => {
        setMustSpin(false)
        setSpinning(false)
        
        // Stop spin sound
        if (spinAudioRef.current) {
            spinAudioRef.current.pause()
            spinAudioRef.current.currentTime = 0
        }
        
        // Play win sound
        if (winAudioRef.current) {
            winAudioRef.current.currentTime = 0
            winAudioRef.current.play().catch(e => console.log('Audio play failed', e))
        }

        if (onSpinComplete) onSpinComplete()
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        )
    }

    if (!campaign || rewards.length === 0) {
        return (
            <div className="text-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">No active Spin the Wheel campaign found.</p>
            </div>
        )
    }

    // Prepare data for react-custom-roulette
    const templateId = campaign.theme_config?.template_id || 'default'
    const style = TEMPLATE_STYLES[templateId] || TEMPLATE_STYLES.default

    const wheelData = rewards.map(r => ({
        option: r.name.length > 15 ? r.name.substring(0, 12) + '...' : r.name,
        style: { backgroundColor: '#ffffff', textColor: style.textColor } 
    }))
    
    // Apply template colors
    const enhancedWheelData = wheelData.map((item, index) => ({
        ...item,
        style: {
            backgroundColor: style.colors[index % style.colors.length],
            textColor: style.textColor
        }
    }))

    return (
        <div className="w-full max-w-md mx-auto">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                {/* Header */}
                <div className="p-6 text-center bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2" style={{ color: primaryColor }}>
                        {campaign.theme_config?.title_text || 'Spin & Win!'}
                    </h2>
                    <p className="text-gray-500 text-sm">
                        Spin the wheel for a chance to win amazing prizes!
                    </p>
                </div>

                {/* Wheel Container */}
                <div className="p-8 flex flex-col items-center justify-center bg-white relative min-h-[400px]">
                    {result && !mustSpin && !spinning ? (
                        <div className="text-center animate-in fade-in zoom-in duration-500 py-8">
                            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Trophy className="w-10 h-10 text-yellow-600" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 mb-3">
                                {result.type === 'no_prize' ? 'So Close!' : 'Congratulations!'}
                            </h3>
                            <p className="text-gray-600 mb-8 text-lg">
                                {result.type === 'no_prize' 
                                    ? (campaign.theme_config?.no_prize_message || 'Better luck next time!')
                                    : (campaign.theme_config?.success_message || 'You won: {{reward_name}}').replace('{{reward_name}}', result.name)
                                }
                            </p>
                            <Button 
                                onClick={() => {
                                    setResult(null)
                                    setSpinning(false)
                                }}
                                className="w-full h-12 text-lg font-bold"
                                style={{ backgroundColor: primaryColor }}
                            >
                                Spin Again
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="mb-8 transform scale-90 sm:scale-100 relative">
                                <Wheel
                                    mustStartSpinning={mustSpin}
                                    prizeNumber={prizeNumber}
                                    data={enhancedWheelData}
                                    onStopSpinning={handleStopSpinning}
                                    spinDuration={0.6}
                                    backgroundColors={style.colors}
                                    textColors={[style.textColor]}
                                    outerBorderColor={style.outerBorderColor}
                                    outerBorderWidth={style.outerBorderWidth}
                                    innerRadius={style.innerRadius}
                                    innerBorderColor={style.innerBorderColor}
                                    innerBorderWidth={0}
                                    radiusLineColor={style.radiusLineColor}
                                    radiusLineWidth={style.radiusLineWidth}
                                    fontSize={14}
                                    perpendicularText={true}
                                    textDistance={60}
                                />
                                {/* Center Image Overlay */}
                                {style.centerImage && (
                                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 z-10 pointer-events-none">
                                        <img 
                                            src={style.centerImage} 
                                            alt="Center" 
                                            className="w-full h-full object-contain drop-shadow-lg"
                                        />
                                    </div>
                                )}
                            </div>
                            
                            {error && (
                                <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    {error}
                                </div>
                            )}

                            <Button 
                                onClick={handleSpinClick} 
                                disabled={spinning || mustSpin}
                                className="w-full h-14 text-xl font-bold rounded-full transition-transform active:scale-95 shadow-lg"
                                style={style.buttonStyle ? style.buttonStyle : { backgroundColor: primaryColor }}
                            >
                                {spinning || mustSpin ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Spinning...
                                    </>
                                ) : (
                                    'SPIN NOW'
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
