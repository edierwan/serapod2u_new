'use client'

import { useMemo, useId } from 'react'
import type { AnimationIntensity } from '@/lib/storefront/banner-constants'

// ── Intensity-based configs ───────────────────────────────────────

interface AuroraConfig {
    drift: number       // translateX/Y px-equivalent percentage
    blur: number        // feGaussianBlur stdDeviation
    opacity: number[]   // per-layer opacity [wave1, wave2, wave3]
    duration: number[]  // per-layer animation seconds [wave1, wave2, wave3]
    scale: number       // max scale during animation
}

const AURORA_CONFIG: Record<string, AuroraConfig> = {
    low: {
        drift: 30,
        blur: 40,
        opacity: [0.35, 0.28, 0.2],
        duration: [24, 20, 28],
        scale: 1.02,
    },
    medium: {
        drift: 55,
        blur: 55,
        opacity: [0.45, 0.38, 0.3],
        duration: [18, 14, 22],
        scale: 1.04,
    },
    high: {
        drift: 80,
        blur: 70,
        opacity: [0.55, 0.48, 0.4],
        duration: [12, 10, 16],
        scale: 1.06,
    },
}

// ── Props ─────────────────────────────────────────────────────────

interface VectorAuroraBackgroundProps {
    intensity?: AnimationIntensity
    animate?: boolean
    /** Speed multiplier for preview panels (1.3x makes motion visible faster) */
    speedMultiplier?: number
    className?: string
}

// ── Component ─────────────────────────────────────────────────────

export default function VectorAuroraBackground({
    intensity = 'medium',
    animate = true,
    speedMultiplier = 1,
    className = '',
}: VectorAuroraBackgroundProps) {
    const rawId = useId()
    const uid = rawId.replace(/:/g, '')

    const cfg = AURORA_CONFIG[intensity] || AURORA_CONFIG.medium

    // Compute durations with speed multiplier
    const dur = cfg.duration.map(d => Math.round((d / speedMultiplier) * 10) / 10)

    // Animation keyframe names unique to this instance
    const w1 = `aurora-w1-${uid}`
    const w2 = `aurora-w2-${uid}`
    const w3 = `aurora-w3-${uid}`

    const keyframesCSS = useMemo(() => {
        const d = cfg.drift
        const s = cfg.scale
        return `
      @keyframes ${w1} {
        0%   { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
        33%  { transform: translate3d(${d * 0.4}px, ${-d * 0.3}px, 0) scale(${1 + (s - 1) * 0.5}) rotate(0.8deg); }
        66%  { transform: translate3d(${-d * 0.3}px, ${d * 0.5}px, 0) scale(${s}) rotate(-0.5deg); }
        100% { transform: translate3d(${d * 0.2}px, ${-d * 0.2}px, 0) scale(1) rotate(0deg); }
      }
      @keyframes ${w2} {
        0%   { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
        33%  { transform: translate3d(${-d * 0.5}px, ${d * 0.4}px, 0) scale(${s}) rotate(-1deg); }
        66%  { transform: translate3d(${d * 0.6}px, ${-d * 0.2}px, 0) scale(${1 + (s - 1) * 0.3}) rotate(0.6deg); }
        100% { transform: translate3d(${-d * 0.15}px, ${d * 0.15}px, 0) scale(1) rotate(0deg); }
      }
      @keyframes ${w3} {
        0%   { transform: translate3d(0, 0, 0) scale(${1 + (s - 1) * 0.2}) rotate(0deg); }
        33%  { transform: translate3d(${d * 0.35}px, ${d * 0.45}px, 0) scale(1) rotate(1.2deg); }
        66%  { transform: translate3d(${-d * 0.45}px, ${-d * 0.35}px, 0) scale(${s}) rotate(-0.8deg); }
        100% { transform: translate3d(${d * 0.1}px, ${-d * 0.1}px, 0) scale(${1 + (s - 1) * 0.2}) rotate(0deg); }
      }
    `
    }, [w1, w2, w3, cfg.drift, cfg.scale])

    return (
        <div className={`absolute inset-0 overflow-hidden ${className}`}>
            {/* Inject keyframes */}
            {animate && <style dangerouslySetInnerHTML={{ __html: keyframesCSS }} />}

            {/* Deep dark base */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e1a] via-[#0d1529] to-[#0f0b1e]" />

            {/* Inline SVG aurora layers */}
            <svg
                viewBox="0 0 1600 900"
                preserveAspectRatio="xMidYMid slice"
                className="absolute inset-0 w-full h-full"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <defs>
                    {/* Gradients */}
                    <linearGradient id={`ag1-${uid}`} x1="0%" y1="30%" x2="100%" y2="70%">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
                        <stop offset="20%" stopColor="#3b82f6" stopOpacity="0.6" />
                        <stop offset="50%" stopColor="#6366f1" stopOpacity="0.8" />
                        <stop offset="80%" stopColor="#8b5cf6" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id={`ag2-${uid}`} x1="100%" y1="20%" x2="0%" y2="80%">
                        <stop offset="0%" stopColor="#ec4899" stopOpacity="0" />
                        <stop offset="25%" stopColor="#a855f7" stopOpacity="0.5" />
                        <stop offset="50%" stopColor="#7c3aed" stopOpacity="0.7" />
                        <stop offset="75%" stopColor="#6366f1" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id={`ag3-${uid}`} x1="20%" y1="0%" x2="80%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
                        <stop offset="30%" stopColor="#3b82f6" stopOpacity="0.4" />
                        <stop offset="60%" stopColor="#8b5cf6" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
                    </linearGradient>

                    {/* Blur filters */}
                    <filter id={`blur1-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation={cfg.blur} /></filter>
                    <filter id={`blur2-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation={cfg.blur * 0.85} /></filter>
                    <filter id={`blur3-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation={cfg.blur * 1.15} /></filter>

                    {/* Subtle grain noise */}
                    <filter id={`grain-${uid}`}>
                        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
                        <feColorMatrix type="saturate" values="0" />
                    </filter>
                </defs>

                {/* Wave layer 1 — blue to indigo, top-flowing */}
                <g
                    filter={`url(#blur1-${uid})`}
                    opacity={cfg.opacity[0]}
                    style={animate ? {
                        animation: `${w1} ${dur[0]}s ease-in-out infinite`,
                        willChange: 'transform',
                        transformOrigin: 'center center',
                    } : undefined}
                >
                    <path
                        d="M-200,350 C100,180 350,520 600,320 C850,120 1000,480 1250,300 C1500,120 1650,400 1800,280 L1800,650 C1550,520 1300,700 1050,550 C800,400 550,680 300,500 C50,320 -100,550 -200,480 Z"
                        fill={`url(#ag1-${uid})`}
                    />
                </g>

                {/* Wave layer 2 — pink to purple, mid-flowing */}
                <g
                    filter={`url(#blur2-${uid})`}
                    opacity={cfg.opacity[1]}
                    style={animate ? {
                        animation: `${w2} ${dur[1]}s ease-in-out infinite`,
                        willChange: 'transform',
                        transformOrigin: 'center center',
                    } : undefined}
                >
                    <path
                        d="M-100,500 C200,350 400,650 700,450 C1000,250 1100,600 1350,420 C1600,240 1700,500 1900,400 L1900,800 C1650,680 1400,850 1100,700 C800,550 600,780 350,620 C100,460 -50,650 -100,580 Z"
                        fill={`url(#ag2-${uid})`}
                    />
                </g>

                {/* Wave layer 3 — cyan to pink, bottom accent */}
                <g
                    filter={`url(#blur3-${uid})`}
                    opacity={cfg.opacity[2]}
                    style={animate ? {
                        animation: `${w3} ${dur[2]}s ease-in-out infinite`,
                        willChange: 'transform',
                        transformOrigin: 'center center',
                    } : undefined}
                >
                    <path
                        d="M-150,200 C150,80 350,340 650,180 C950,20 1050,300 1400,160 C1600,80 1750,280 1850,200 L1850,520 C1600,400 1350,560 1050,380 C750,200 550,440 300,300 C50,160 -100,350 -150,280 Z"
                        fill={`url(#ag3-${uid})`}
                    />
                </g>

                {/* Grain noise overlay */}
                <rect
                    width="100%"
                    height="100%"
                    filter={`url(#grain-${uid})`}
                    opacity="0.03"
                />
            </svg>

            {/* Extra soft ambient glow spots (CSS) to complement SVG waves */}
            <div className="absolute pointer-events-none" style={{
                width: '40%', height: '40%', top: '10%', left: '5%',
                background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
                filter: 'blur(60px)',
            }} />
            <div className="absolute pointer-events-none" style={{
                width: '35%', height: '35%', bottom: '10%', right: '10%',
                background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
                filter: 'blur(50px)',
            }} />
        </div>
    )
}

// ── Exports for HUD labels ────────────────────────────────────────

export function getAuroraHudLabel(intensity: AnimationIntensity, speedMultiplier = 1): string {
    const cfg = AURORA_CONFIG[intensity] || AURORA_CONFIG.medium
    const layers = 3
    const baseDur = Math.round(cfg.duration[0] / speedMultiplier)
    return `${layers} layers · ${cfg.drift}px drift · ${baseDur}s loop`
}

export { AURORA_CONFIG }
