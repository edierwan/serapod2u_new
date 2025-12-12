'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DailyQuizGameProps {
    primaryColor: string
    onQuizComplete?: (score: number) => void
}

export default function DailyQuizGame({
    primaryColor = '#3B82F6',
    onQuizComplete
}: DailyQuizGameProps) {
    const [currentQuestion, setCurrentQuestion] = useState(0)
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
    const [isAnswered, setIsAnswered] = useState(false)
    const [score, setScore] = useState(0)
    const [quizCompleted, setQuizCompleted] = useState(false)

    // Mock questions - in real app, these would come from props or API
    const questions = [
        {
            question: "What is the main ingredient in our premium pods?",
            options: ["Natural Extracts", "Synthetic Flavors", "Sugar", "Water"],
            correct: 0
        },
        {
            question: "How many points do you earn per scan?",
            options: ["10 Points", "50 Points", "100 Points", "It varies"],
            correct: 3
        },
        {
            question: "Which flavor is our best seller?",
            options: ["Mango", "Mint", "Tobacco", "Berry"],
            correct: 0
        }
    ]

    const handleAnswer = (index: number) => {
        if (isAnswered) return
        setSelectedAnswer(index)
        setIsAnswered(true)

        if (index === questions[currentQuestion].correct) {
            setScore(score + 1)
        }

        setTimeout(() => {
            if (currentQuestion < questions.length - 1) {
                setCurrentQuestion(currentQuestion + 1)
                setSelectedAnswer(null)
                setIsAnswered(false)
            } else {
                setQuizCompleted(true)
                if (onQuizComplete) onQuizComplete(score + (index === questions[currentQuestion].correct ? 1 : 0))
            }
        }, 1500)
    }

    if (quizCompleted) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-white rounded-xl shadow-lg text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Quiz Completed!</h3>
                <p className="text-gray-600 mb-6">
                    You scored {score} out of {questions.length}
                </p>
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 mb-6">
                    <p className="text-blue-800 font-medium">
                        You earned {score * 10} points!
                    </p>
                </div>
                <Button 
                    className="w-full"
                    style={{ backgroundColor: primaryColor }}
                    onClick={() => window.location.reload()} // Reset for demo
                >
                    Play Again Tomorrow
                </Button>
            </div>
        )
    }

    const question = questions[currentQuestion]

    return (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Progress Bar */}
            <div className="h-2 bg-gray-100">
                <div 
                    className="h-full transition-all duration-300"
                    style={{ 
                        width: `${((currentQuestion + 1) / questions.length) * 100}%`,
                        backgroundColor: primaryColor 
                    }}
                />
            </div>

            <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <span className="text-sm font-medium text-gray-500">
                        Question {currentQuestion + 1}/{questions.length}
                    </span>
                    <span className="text-sm font-medium" style={{ color: primaryColor }}>
                        {score * 10} Points
                    </span>
                </div>

                <h3 className="text-xl font-bold text-gray-900 mb-8">
                    {question.question}
                </h3>

                <div className="space-y-3">
                    {question.options.map((option, index) => (
                        <button
                            key={index}
                            onClick={() => handleAnswer(index)}
                            disabled={isAnswered}
                            className={cn(
                                "w-full p-4 text-left rounded-xl border-2 transition-all duration-200 flex items-center justify-between",
                                isAnswered && index === question.correct
                                    ? "border-green-500 bg-green-50 text-green-700"
                                    : isAnswered && index === selectedAnswer && index !== question.correct
                                    ? "border-red-500 bg-red-50 text-red-700"
                                    : selectedAnswer === index
                                    ? "border-blue-500 bg-blue-50"
                                    : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                            )}
                        >
                            <span className="font-medium">{option}</span>
                            {isAnswered && index === question.correct && (
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                            )}
                            {isAnswered && index === selectedAnswer && index !== question.correct && (
                                <XCircle className="w-5 h-5 text-red-500" />
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
