'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, HelpCircle, Loader2, ArrowRight, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface DailyQuizGameProps {
    primaryColor: string
    journeyId?: string
    qrCode?: string
    onQuizComplete?: (score: number) => void
}

export default function DailyQuizGame({
    primaryColor = '#3B82F6',
    journeyId,
    qrCode,
    onQuizComplete
}: DailyQuizGameProps) {
    const [loading, setLoading] = useState(true)
    const [campaign, setCampaign] = useState<any>(null)
    const [questions, setQuestions] = useState<any[]>([])
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
    const [answers, setAnswers] = useState<Record<string, number>>({})
    const [isAnswered, setIsAnswered] = useState(false)
    const [quizCompleted, setQuizCompleted] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [submitting, setSubmitting] = useState(false)
    const { toast } = useToast()
    const supabase = createClient()

    useEffect(() => {
        if (journeyId) {
            fetchCampaign()
        }
    }, [journeyId])

    const fetchCampaign = async () => {
        try {
            // Find active campaign
            const { data: campaigns, error: campError } = await supabase
                .from('daily_quiz_campaigns')
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

            // Fetch questions
            const { data: questionsData, error: qError } = await supabase
                .from('daily_quiz_questions')
                .select('id, question_text, options, order_no')
                .eq('campaign_id', activeCampaign.id)
                .order('order_no', { ascending: true })
            
            if (qError) throw qError

            if (questionsData) {
                setQuestions(questionsData)
            }
        } catch (err) {
            console.error('Error loading quiz:', err)
            toast({ title: "Error", description: "Failed to load quiz", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }

    const handleAnswer = (index: number) => {
        if (isAnswered) return
        
        setSelectedAnswer(index)
        setIsAnswered(true)
        
        const currentQ = questions[currentQuestionIndex]
        setAnswers(prev => ({ ...prev, [currentQ.id]: index }))

        // Auto advance after delay
        setTimeout(() => {
            if (currentQuestionIndex < questions.length - 1) {
                setCurrentQuestionIndex(prev => prev + 1)
                setSelectedAnswer(null)
                setIsAnswered(false)
            } else {
                submitQuiz({ ...answers, [currentQ.id]: index })
            }
        }, 800)
    }

    const submitQuiz = async (finalAnswers: Record<string, number>) => {
        setSubmitting(true)
        try {
            const response = await fetch('/api/games/daily-quiz/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaign_id: campaign.id,
                    qr_code: qrCode,
                    answers: finalAnswers
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit quiz')
            }

            setResult(data)
            setQuizCompleted(true)
            if (onQuizComplete) onQuizComplete(data.score)

        } catch (err: any) {
            console.error('Quiz submit error:', err)
            toast({ title: "Error", description: "Failed to submit quiz", variant: "destructive" })
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        )
    }

    if (!campaign || questions.length === 0) {
        return (
            <div className="text-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500">No active Daily Quiz campaign found.</p>
            </div>
        )
    }

    if (quizCompleted && result) {
        const percentage = Math.round((result.score / result.totalQuestions) * 100)
        
        return (
            <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-500">
                <div className="p-8 text-center">
                    <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}20` }}>
                        <Trophy className="w-12 h-12" style={{ color: primaryColor }} />
                    </div>
                    
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">Quiz Completed!</h2>
                    <p className="text-gray-500 mb-8">Here is how you performed</p>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="p-4 bg-gray-50 rounded-xl">
                            <p className="text-sm text-gray-500 mb-1">Score</p>
                            <p className="text-2xl font-bold text-gray-900">{result.score}/{result.totalQuestions}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                            <p className="text-sm text-gray-500 mb-1">Points Earned</p>
                            <p className="text-2xl font-bold text-green-600">+{result.pointsEarned}</p>
                        </div>
                    </div>

                    <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden mb-8">
                        <div 
                            className="absolute top-0 left-0 h-full transition-all duration-1000 ease-out rounded-full"
                            style={{ width: `${percentage}%`, backgroundColor: primaryColor }}
                        />
                    </div>

                    <Button 
                        className="w-full h-12 text-lg font-bold rounded-xl"
                        style={{ backgroundColor: primaryColor }}
                        onClick={() => window.location.reload()}
                    >
                        Play Again Tomorrow
                    </Button>
                </div>
            </div>
        )
    }

    const currentQuestion = questions[currentQuestionIndex]
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100

    return (
        <div className="w-full max-w-md mx-auto">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                {/* Header with Progress */}
                <div className="bg-gray-50 p-6 border-b border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-medium text-gray-500">
                            Question {currentQuestionIndex + 1} of {questions.length}
                        </span>
                        <span className="text-sm font-bold" style={{ color: primaryColor }}>
                            {Math.round(progress)}%
                        </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                            className="h-full transition-all duration-500 ease-out rounded-full"
                            style={{ width: `${progress}%`, backgroundColor: primaryColor }}
                        />
                    </div>
                </div>

                {/* Question Card */}
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-8 leading-relaxed">
                        {currentQuestion.question_text}
                    </h3>

                    <div className="space-y-3">
                        {currentQuestion.options.map((option: string, idx: number) => (
                            <button
                                key={idx}
                                onClick={() => handleAnswer(idx)}
                                disabled={isAnswered || submitting}
                                className={cn(
                                    "w-full p-4 text-left rounded-xl border-2 transition-all duration-200 flex items-center justify-between group",
                                    selectedAnswer === idx 
                                        ? "border-blue-500 bg-blue-50 text-blue-700"
                                        : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700"
                                )}
                                style={selectedAnswer === idx ? { borderColor: primaryColor, backgroundColor: `${primaryColor}10`, color: primaryColor } : {}}
                            >
                                <span className="font-medium">{option}</span>
                                {selectedAnswer === idx && (
                                    <CheckCircle2 className="w-5 h-5" style={{ color: primaryColor }} />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
                    <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
                        <HelpCircle className="w-3 h-3" />
                        Answer correctly to earn points
                    </p>
                </div>
            </div>
        </div>
    )
}
