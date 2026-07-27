'use client'

import { Fragment } from 'react'
import { CheckCircle2 } from 'lucide-react'

export type StockCountWizardStepId = 'setup' | 'count' | 'review'

export type StockCountWizardStep = {
  id: StockCountWizardStepId
  n: string
  label: string
  hint: string
}

type StockCountWizardStepsProps = {
  steps: StockCountWizardStep[]
  currentStep: StockCountWizardStepId
  onStepChange: (step: StockCountWizardStepId) => void
}

/** Presentational only — same markup/classes as inline Stock Count wizard stepper. */
export function StockCountWizardSteps({ steps, currentStep, onStepChange }: StockCountWizardStepsProps) {
  const currentIndex = steps.findIndex(step => step.id === currentStep)

  return (
    <nav className="sera-stock-count__steps" aria-label="Stock count steps">
      {steps.map((step, index) => {
        const isActive = currentStep === step.id
        const isDone = index < currentIndex
        return (
          <Fragment key={step.id}>
            {index > 0 && (
              <div
                className={`sera-stock-count__connector${index <= currentIndex ? ' is-done' : ''}`}
                aria-hidden
              />
            )}
            <button
              type="button"
              aria-current={isActive ? 'step' : undefined}
              className={`sera-stock-count__step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
              onClick={() => onStepChange(step.id)}
            >
              <span className="sera-stock-count__step-index" aria-hidden>
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : step.n}
              </span>
              <span className="sera-stock-count__step-copy">
                <span className="sera-stock-count__step-label">{step.label}</span>
                <span className="sera-stock-count__step-hint">{step.hint}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
