'use client'

import { useEffect, useRef, type ReactNode } from 'react'

type RevealVariant = 'up' | 'fade' | 'left' | 'right' | 'scale'

interface StoreRevealProps {
  children: ReactNode
  className?: string
  /** Stagger delay in ms */
  delay?: number
  variant?: RevealVariant
  /** Replay when scrolling back into view (default: once) */
  once?: boolean
}

/**
 * Scroll-triggered entrance animation. Visual only — does not change
 * interactivity, data, or navigation behavior of children.
 */
export default function StoreReveal({
  children,
  className = '',
  delay = 0,
  variant = 'up',
  once = true,
}: StoreRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      el.classList.add('is-revealed')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add('is-revealed')
            if (once) observer.unobserve(el)
          } else if (!once) {
            el.classList.remove('is-revealed')
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [once])

  return (
    <div
      ref={ref}
      className={`store-reveal store-reveal--${variant} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
