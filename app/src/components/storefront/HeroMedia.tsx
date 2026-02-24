'use client'

import { useEffect, useState, useRef, useCallback, useId, useMemo } from 'react'
import Image from 'next/image'
import type { AnimationStyle, AnimationIntensity } from '@/lib/storefront/banner-constants'
import VectorAuroraBackground from '@/components/storefront/VectorAuroraBackground'

// ── Types ─────────────────────────────────────────────────────────

interface HeroMediaProps {
    imageUrl: string
    alt?: string
    animationEnabled?: boolean
    animationStyle?: AnimationStyle
    intensity?: AnimationIntensity
    context?: 'landing' | 'login'
    priority?: boolean
    className?: string
    children?: React.ReactNode
}

// ── Ken Burns config ──────────────────────────────────────────────

const KENBURNS_CSS: Record<string, { duration: string; scaleFrom: number; scaleTo: number; translateRange: string }> = {
    low: { duration: '14s', scaleFrom: 1.0, scaleTo: 1.04, translateRange: '0.5%' },
    medium: { duration: '11s', scaleFrom: 1.0, scaleTo: 1.06, translateRange: '1%' },
    high: { duration: '9s', scaleFrom: 1.0, scaleTo: 1.10, translateRange: '2%' },
}

// ── Component ─────────────────────────────────────────────────────

export default function HeroMedia({
    imageUrl,
    alt = 'Hero banner',
    animationEnabled = false,
    animationStyle = 'none',
    intensity = 'low',
    context = 'landing',
    priority = false,
    className = '',
    children,
}: HeroMediaProps) {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const [scrollY, setScrollY] = useState(0)

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        setPrefersReducedMotion(mq.matches)
        const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])

    const handleScroll = useCallback(() => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const viewH = window.innerHeight
        const center = rect.top + rect.height / 2
        const normalized = (center - viewH / 2) / viewH
        setScrollY(normalized)
    }, [])

    const shouldAnimate = animationEnabled && !prefersReducedMotion && animationStyle !== 'none'

    useEffect(() => {
        if (shouldAnimate && animationStyle === 'parallax') {
            const isTouch = window.matchMedia('(pointer: coarse)').matches
            if (isTouch) return
            window.addEventListener('scroll', handleScroll, { passive: true })
            handleScroll()
            return () => window.removeEventListener('scroll', handleScroll)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animationStyle, animationEnabled, prefersReducedMotion])

    const maxOffset = intensity === 'high' ? 16 : intensity === 'medium' ? 12 : 8
    const parallaxY = shouldAnimate && animationStyle === 'parallax'
        ? Math.max(-maxOffset, Math.min(maxOffset, scrollY * maxOffset * 2))
        : 0

    const kb = KENBURNS_CSS[intensity] || KENBURNS_CSS.low

    // Unique stable ID for keyframe names (no colons)
    const rawId = useId()
    const uid = rawId.replace(/:/g, '')

    // Build Ken Burns keyframes only — Float Glow is now handled by VectorAuroraBackground
    const keyframesCSS = useMemo(() => {
        const kbName = `hm-kb-${uid}`
        return `
      @keyframes ${kbName} {
        0%   { transform: scale(${kb.scaleFrom}) translate(0, 0); }
        100% { transform: scale(${kb.scaleTo}) translate(${kb.translateRange}, ${kb.translateRange}); }
      }
    `
    }, [uid, kb.scaleFrom, kb.scaleTo, kb.translateRange])

    const kbAnimName = `hm-kb-${uid}`

    return (
        <div ref={containerRef} className={`absolute inset-0 overflow-hidden ${className}`}>
            {/* Inject keyframes as unscoped <style> */}
            <style dangerouslySetInnerHTML={{ __html: keyframesCSS }} />

            {/* Background image with Ken Burns or Parallax */}
            <div
                className="absolute inset-0"
                style={{
                    willChange: shouldAnimate ? 'transform' : undefined,
                    animation:
                        shouldAnimate && animationStyle === 'kenburns'
                            ? `${kbAnimName} ${kb.duration} ease-in-out infinite alternate`
                            : undefined,
                    transform:
                        shouldAnimate && animationStyle === 'parallax'
                            ? `translateY(${parallaxY}px)`
                            : undefined,
                }}
            >
                {imageUrl ? (
                    <Image
                        src={imageUrl}
                        alt={alt}
                        fill
                        className="object-cover"
                        priority={priority}
                        sizes={context === 'login' ? '60vw' : '100vw'}
                        unoptimized
                    />
                ) : (
                    /* SVG vector aurora background when no image is set */
                    <VectorAuroraBackground
                        intensity={intensity}
                        animate={shouldAnimate}
                    />
                )}
            </div>

            {/* Float Glow → Vector Aurora SVG overlay (shows on top of image when floatGlow selected) */}
            {shouldAnimate && animationStyle === 'floatGlow' && imageUrl && (
                <VectorAuroraBackground
                    intensity={intensity}
                    animate={shouldAnimate}
                    className="z-[1]"
                />
            )}

            {/* Overlay for text readability */}
            {context === 'landing' && (
                <div className="absolute inset-0 bg-gradient-to-r from-gray-900/85 via-gray-900/50 to-transparent" />
            )}
            {context === 'login' && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
            )}

            {children}
        </div>
    )
}
