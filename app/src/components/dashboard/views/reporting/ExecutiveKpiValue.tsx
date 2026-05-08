import type { ReactNode } from 'react'

interface ExecutiveKpiValueProps {
  children: ReactNode
  className?: string
}

export const executiveKpiValueClassName = 'inline-flex max-w-full min-w-0 items-baseline whitespace-nowrap text-2xl font-bold leading-none text-foreground tabular-nums'

export default function ExecutiveKpiValue({ children, className = '' }: ExecutiveKpiValueProps) {
  return (
    <div className="min-w-0 overflow-hidden">
      <div className={`${executiveKpiValueClassName} ${className}`.trim()}>
        {children}
      </div>
    </div>
  )
}