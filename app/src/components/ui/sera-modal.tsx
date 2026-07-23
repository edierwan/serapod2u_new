'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Shared Serapod modal shell for custom (non-Radix) overlays. */
export function SeraModalOverlay({
  className,
  children,
  onBackdropClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onBackdropClick?: () => void }) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const overlay = (
    <div
      className={cn('sera-modal-overlay', className)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick?.()
      }}
      {...props}
    >
      {children}
    </div>
  )

  // Portal to body so sticky module top-navs (z-40) never cover the modal.
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}

export function SeraModalPanel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn('sera-modal-panel', className)}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  )
}

export function SeraModalHeader({
  className,
  title,
  onClose,
  sticky,
  children,
}: {
  className?: string
  title?: React.ReactNode
  onClose?: () => void
  sticky?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={cn('sera-modal-header', sticky && 'is-sticky', className)}>
      {children ?? (title != null ? <h2 className="sera-modal-title">{title}</h2> : null)}
      {onClose && (
        <button type="button" onClick={onClose} className="sera-modal-close" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function SeraModalBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('sera-modal-body', className)} {...props}>
      {children}
    </div>
  )
}

export function SeraModalFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('sera-modal-footer', className)} {...props}>
      {children}
    </div>
  )
}
