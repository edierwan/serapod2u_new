'use client'

import { cn } from '@/lib/utils'

export type SeraLoaderSize = 'xs' | 'sm' | 'md' | 'lg'

export interface SeraLoaderProps {
  size?: SeraLoaderSize
  className?: string
  /** Accessible label — defaults to "Loading" */
  label?: string
}

/** Serapod 3D orb loader — use for inline / embedded loading indicators */
export function SeraLoader({ size = 'md', className, label = 'Loading' }: SeraLoaderProps) {
  if (size === 'xs' || size === 'sm') {
    return (
      <span
        className={cn('sera-loader', `sera-loader--${size}`, className)}
        role="status"
        aria-label={label}
      >
        <span className="sera-loader__spin-flat" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <div
      className={cn('sera-loader', `sera-loader--${size}`, className)}
      role="status"
      aria-label={label}
    >
      <div className="sera-loader__stage" aria-hidden>
        <div className="sera-loader__glow" />
        <div className="sera-loader__orbit">
          <div className="sera-loader__ring" />
          <div className="sera-loader__ring sera-loader__ring--inner" />
          <div className="sera-loader__core" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

export type SeraLoadingVariant = 'page' | 'section' | 'inline' | 'overlay'

export interface SeraLoadingStateProps {
  /** Shown below the loader — e.g. "Loading executive dashboard" */
  label?: string
  variant?: SeraLoadingVariant
  size?: SeraLoaderSize
  className?: string
  minHeight?: string
}

/**
 * Unified full-page / section loading shell for the Serapod dashboard.
 * Prefer this over ad-hoc Loader2 + flex center patterns.
 */
export function SeraLoadingState({
  label,
  variant = 'section',
  size,
  className,
  minHeight,
}: SeraLoadingStateProps) {
  const loaderSize: SeraLoaderSize =
    size ?? (variant === 'page' ? 'lg' : variant === 'inline' ? 'sm' : 'md')

  return (
    <div
      className={cn(
        'sera-loading-state',
        `sera-loading-state--${variant}`,
        className,
      )}
      style={minHeight ? { minHeight } : undefined}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <SeraLoader size={loaderSize} label={label ?? 'Loading'} />
      {label ? <p className="sera-loading-state__label">{label}</p> : null}
    </div>
  )
}
