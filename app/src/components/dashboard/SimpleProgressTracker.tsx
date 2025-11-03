'use client'

import { CheckCircle } from 'lucide-react'

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

interface SimpleProgressTrackerProps {
  steps: StepData[]
  totalCases: number
}

export default function SimpleProgressTracker({
  steps,
  totalCases
}: SimpleProgressTrackerProps) {
  // Find the furthest step with active cases
  const lastActiveStepIndex = steps.reduce((maxIndex, step, index) => {
    return step.count > 0 ? index : maxIndex
  }, -1)

  return (
    <div className="w-full space-y-3">
      {/* Steps Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {steps.map((step, index) => {
          const Icon = step.icon
          const isActive = step.count > 0
          const isCompleted = index < lastActiveStepIndex
          const isCurrent = index === lastActiveStepIndex

          return (
            <div
              key={step.key}
              className={`relative rounded-lg border-2 p-4 transition-all ${
                isCompleted
                  ? 'border-emerald-500 bg-emerald-50'
                  : isCurrent
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {/* Icon */}
              <div
                className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-3 ${
                  isCompleted
                    ? 'bg-emerald-500'
                    : isCurrent
                    ? 'bg-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle className="w-5 h-5 text-white" />
                ) : (
                  <Icon
                    className={`w-5 h-5 ${
                      isCurrent ? 'text-white' : 'text-gray-400'
                    }`}
                  />
                )}
              </div>

              {/* Label */}
              <p
                className={`text-xs font-medium mb-2 ${
                  isActive ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {step.label}
              </p>

              {/* Count */}
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold ${
                    isCompleted
                      ? 'text-emerald-600'
                      : isCurrent
                      ? 'text-blue-600'
                      : 'text-gray-400'
                  }`}
                >
                  {step.count}
                </span>
                <span
                  className={`text-xs font-medium ${
                    isActive ? 'text-gray-600' : 'text-gray-400'
                  }`}
                >
                  {step.percent}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress Bar */}
      <div className="pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Pipeline Progression
          </span>
          <span className="text-sm font-bold text-gray-900">
            {Math.round(
              (steps.reduce((sum, step) => sum + step.percent, 0) /
                steps.length) *
                10
            ) / 10}
            % Complete
          </span>
        </div>
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{
              width: `${
                Math.round(
                  (steps.reduce((sum, step) => sum + step.percent, 0) /
                    steps.length) *
                    10
                ) / 10
              }%`
            }}
          />
        </div>
      </div>
    </div>
  )
}
