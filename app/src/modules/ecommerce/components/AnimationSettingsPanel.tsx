'use client'

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import type { AnimationStyle, AnimationIntensity } from '@/lib/storefront/banner-constants'
import { ANIMATION_STYLES, ANIMATION_INTENSITIES } from '@/lib/storefront/banner-constants'
import VectorAuroraBackground, { getAuroraHudLabel } from '@/components/storefront/VectorAuroraBackground'

// ── Types ─────────────────────────────────────────────────────────

interface AnimationSettingsPanelProps {
    enabled: boolean
    style: AnimationStyle
    intensity: AnimationIntensity
    imageUrl?: string
    context?: 'landing' | 'login'
    onChange: (update: {
        animation_enabled?: boolean
        animation_style?: AnimationStyle
        animation_intensity?: AnimationIntensity
    }) => void
}

// ── Animation configs per intensity ───────────────────────────────

const KB_CONFIG = {
    low: { scaleFrom: 1.05, scaleTo: 1.12, panPct: 3, duration: 12 },
    medium: { scaleFrom: 1.08, scaleTo: 1.20, panPct: 5, duration: 9 },
    high: { scaleFrom: 1.12, scaleTo: 1.28, panPct: 7, duration: 7 },
}

const PARALLAX_CONFIG = {
    low: { shiftPx: 6 },
    medium: { shiftPx: 12 },
    high: { shiftPx: 20 },
}

function getMotionLabel(style: AnimationStyle, intensity: AnimationIntensity): string {
    if (style === 'kenburns') {
        const kb = KB_CONFIG[intensity]
        const zoom = Math.round((kb.scaleTo - 1) * 100)
        return `Zoom ${zoom}% · Pan ±${kb.panPct}% · ${kb.duration}s`
    }
    if (style === 'floatGlow') {
        return getAuroraHudLabel(intensity, 1.3)
    }
    if (style === 'parallax') {
        const px = PARALLAX_CONFIG[intensity]
        return `±${px.shiftPx}px shift · Mouse-tracked`
    }
    return ''
}

// ── Component ─────────────────────────────────────────────────────

export default function AnimationSettingsPanel({
    enabled,
    style,
    intensity,
    imageUrl,
    context = 'landing',
    onChange,
}: AnimationSettingsPanelProps) {
    const previewRef = useRef<HTMLDivElement>(null)
    const bgRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number>(0)
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        setPrefersReducedMotion(mq.matches)
        const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])

    // Parallax mouse tracking
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!previewRef.current || !bgRef.current) return
        const rect = previewRef.current.getBoundingClientRect()
        const px = PARALLAX_CONFIG[intensity].shiftPx
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
        const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            if (bgRef.current) {
                bgRef.current.style.transform = `translate(${nx * px}px, ${ny * px}px)`
            }
        })
    }, [intensity])

    const handleMouseLeave = useCallback(() => {
        cancelAnimationFrame(rafRef.current)
        if (bgRef.current) {
            bgRef.current.style.transition = 'transform 0.4s ease-out'
            bgRef.current.style.transform = 'translate(0, 0)'
            setTimeout(() => { if (bgRef.current) bgRef.current.style.transition = '' }, 400)
        }
    }, [])

    useEffect(() => {
        const el = previewRef.current
        if (!el || style !== 'parallax' || prefersReducedMotion) return
        el.addEventListener('mousemove', handleMouseMove)
        el.addEventListener('mouseleave', handleMouseLeave)
        return () => {
            el.removeEventListener('mousemove', handleMouseMove)
            el.removeEventListener('mouseleave', handleMouseLeave)
            cancelAnimationFrame(rafRef.current)
        }
    }, [style, intensity, prefersReducedMotion, handleMouseMove, handleMouseLeave])

    const kb = KB_CONFIG[intensity]
    const shouldAnimate = !prefersReducedMotion

    // Ken Burns keyframes only — Float Glow now uses VectorAuroraBackground component
    const keyframesCSS = useMemo(() => `
    @keyframes asp-kb {
      0%   { transform: scale(${kb.scaleFrom}) translate(-${kb.panPct}%, -${kb.panPct / 2}%); }
      100% { transform: scale(${kb.scaleTo}) translate(${kb.panPct}%, ${kb.panPct / 2}%); }
    }
  `, [kb.scaleFrom, kb.scaleTo, kb.panPct])

    // ── Shared animated background (used inside left panel of preview) ──
    const renderAnimatedBackground = (isLogin: boolean) => (
        <>
            {/* Background layer — Ken Burns / Parallax target */}
            <div
                ref={style === 'parallax' ? bgRef : undefined}
                className="absolute inset-[-20px]"
                style={{
                    willChange: shouldAnimate ? 'transform' : undefined,
                    transformOrigin: 'center center',
                    animation:
                        shouldAnimate && style === 'kenburns'
                            ? `asp-kb ${kb.duration}s cubic-bezier(0.4,0,0.2,1) infinite alternate`
                            : undefined,
                    transition: style === 'parallax' ? 'transform 0.08s linear' : undefined,
                }}
            >
                {imageUrl ? (
                    <img src={imageUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                    /* SVG vector aurora as default background — makes Ken Burns motion clearly visible */
                    <VectorAuroraBackground
                        intensity={intensity}
                        animate={shouldAnimate && style === 'kenburns'}
                        speedMultiplier={1.3}
                    />
                )}
            </div>

            {/* Float Glow → full SVG vector aurora overlay with 1.3x speed for preview visibility */}
            {shouldAnimate && style === 'floatGlow' && (
                <VectorAuroraBackground
                    intensity={intensity}
                    animate={true}
                    speedMultiplier={1.3}
                    className="z-[1]"
                />
            )}

            {/* Gradient overlay */}
            {isLogin ? (
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15 z-[2]" />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-gray-900/80 via-gray-900/40 to-transparent z-[2]" />
            )}
        </>
    )

    return (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            {/* Header + toggle */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-foreground">Banner Animation</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                            onChange({
                                animation_enabled: e.target.checked,
                                animation_style: e.target.checked && style === 'none' ? 'kenburns' : style,
                            })
                        }
                        className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-500/30 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-violet-600" />
                </label>
            </div>

            {enabled && (
                <div className="space-y-4 pt-1">
                    {/* Animation style selector */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Animation Style
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {ANIMATION_STYLES.filter((s) => s.value !== 'none').map((s) => (
                                <button
                                    key={s.value}
                                    type="button"
                                    onClick={() => onChange({ animation_style: s.value })}
                                    className={`relative p-2.5 rounded-lg border text-left transition-all text-xs ${style === s.value
                                            ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 ring-1 ring-violet-500/30'
                                            : 'border-border hover:border-violet-200 dark:hover:border-violet-700'
                                        }`}
                                >
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${style === s.value ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground'
                                            }`}>
                                            {s.value === 'kenburns' ? 'KB' : s.value === 'floatGlow' ? 'FG' : 'PX'}
                                        </div>
                                        <span className="font-medium text-foreground">{s.label}</span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-tight">{s.description}</p>
                                    {style === s.value && (
                                        <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-violet-600 flex items-center justify-center">
                                            <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Intensity */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Intensity
                        </label>
                        <select
                            value={intensity}
                            onChange={(e) => onChange({ animation_intensity: e.target.value as AnimationIntensity })}
                            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                        >
                            {ANIMATION_INTENSITIES.map((i) => (
                                <option key={i.value} value={i.value}>{i.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* ── Split-Screen Preview — matches actual login page ── */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Live Preview {context === 'login' ? '— Login Page Layout' : '— Landing Hero'}
                            </label>
                            <span className="text-[9px] font-mono text-muted-foreground/70 tabular-nums">
                                {getMotionLabel(style, intensity)}
                            </span>
                        </div>

                        {context === 'login' ? (
                            /* ── LOGIN PREVIEW: Split screen matching image 3 exactly ── */
                            <div className="rounded-xl overflow-hidden border border-border shadow-lg" style={{ height: '380px' }}>
                                <div className="flex h-full">
                                    {/* LEFT: Animated hero panel (60%) */}
                                    <div
                                        ref={previewRef}
                                        className="relative w-[58%] h-full overflow-hidden bg-gray-900 select-none"
                                        style={{ cursor: style === 'parallax' ? 'crosshair' : 'default' }}
                                    >
                                        {renderAnimatedBackground(true)}

                                        {/* Parallax hint */}
                                        {style === 'parallax' && (
                                            <div className="absolute top-3 left-3 z-20 bg-black/50 backdrop-blur-sm rounded-md px-2 py-1">
                                                <p className="text-[9px] text-white/80 font-medium">↔ Move mouse to preview</p>
                                            </div>
                                        )}

                                        {/* Active style badge */}
                                        <div className="absolute top-3 right-3 z-20 bg-violet-600/80 backdrop-blur-sm rounded-md px-2 py-1">
                                            <p className="text-[9px] text-white font-semibold uppercase tracking-wider">
                                                {style === 'kenburns' ? '● Ken Burns' : style === 'floatGlow' ? '● Float Glow' : '● Parallax'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* RIGHT: Fake login form (40%) — matches real login page */}
                                    <div className="flex-1 bg-white flex flex-col">
                                        {/* Top bar */}
                                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                                            <div className="flex items-center gap-1.5">
                                                <div className="h-5 w-5 bg-gradient-to-br from-blue-600 to-indigo-600 rounded flex items-center justify-center">
                                                    <span className="text-white font-bold text-[8px]">S</span>
                                                </div>
                                                <span className="text-[10px] font-semibold text-gray-900">Serapod2U</span>
                                            </div>
                                            <span className="text-[8px] text-gray-400">Need help?</span>
                                        </div>

                                        {/* Form content */}
                                        <div className="flex-1 flex items-center justify-center px-5">
                                            <div className="w-full max-w-[200px] space-y-3">
                                                <div>
                                                    <div className="text-sm font-bold text-gray-900">Log In</div>
                                                    <div className="text-[8px] text-gray-500">Welcome back! Sign in to continue.</div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <div>
                                                        <div className="text-[7px] font-medium text-gray-700 mb-0.5">Phone number / Email</div>
                                                        <div className="h-6 rounded border border-gray-200 bg-gray-50 flex items-center px-2">
                                                            <span className="text-[7px] text-gray-400">Enter your email or phone number</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[7px] font-medium text-gray-700 mb-0.5">Password</div>
                                                        <div className="h-6 rounded border border-gray-200 bg-gray-50 flex items-center px-2">
                                                            <span className="text-[7px] text-gray-400">Enter your password</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="h-6 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 flex items-center justify-center">
                                                    <span className="text-white text-[8px] font-semibold tracking-wider uppercase">Log In</span>
                                                </div>

                                                <div className="text-center">
                                                    <span className="text-[7px] text-violet-600">Forgot Password</span>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-px bg-gray-200" />
                                                    <span className="text-[7px] text-gray-400">OR</span>
                                                    <div className="flex-1 h-px bg-gray-200" />
                                                </div>

                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <div className="h-6 rounded border border-gray-200 flex items-center justify-center gap-1">
                                                        <div className="w-3 h-3 rounded-full bg-blue-600 flex items-center justify-center">
                                                            <span className="text-white text-[6px] font-bold">f</span>
                                                        </div>
                                                        <span className="text-[7px] text-gray-700 font-medium">Facebook</span>
                                                    </div>
                                                    <div className="h-6 rounded border border-gray-200 flex items-center justify-center gap-1">
                                                        <span className="text-[8px]">G</span>
                                                        <span className="text-[7px] text-gray-700 font-medium">Google</span>
                                                    </div>
                                                </div>

                                                <div className="text-center pt-1">
                                                    <span className="text-[7px] text-gray-500">New to Serapod2U? </span>
                                                    <span className="text-[7px] text-violet-600 font-medium">Sign Up</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div className="px-4 py-2 text-center border-t border-gray-50">
                                            <span className="text-[7px] text-gray-400">© 2025 Serapod2U. All rights reserved.</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* ── LANDING PREVIEW: Full-width hero ── */
                            <div
                                ref={previewRef}
                                className="relative h-56 rounded-xl overflow-hidden border border-border bg-gray-900 select-none"
                                style={{ cursor: style === 'parallax' ? 'crosshair' : 'default' }}
                            >
                                {renderAnimatedBackground(false)}

                                {/* Landing content overlay */}
                                <div className="absolute inset-0 flex items-center z-10 pointer-events-none">
                                    <div className="ml-8 space-y-2">
                                        <div className="w-16 h-4 rounded bg-white/20" />
                                        <div className="w-40 h-5 rounded bg-white/30" />
                                        <div className="w-28 h-3 rounded bg-white/15" />
                                        <div className="w-20 h-7 rounded-md bg-violet-600/70 mt-3" />
                                    </div>
                                </div>

                                {/* Parallax hint */}
                                {style === 'parallax' && (
                                    <div className="absolute top-3 right-3 z-20 bg-black/50 backdrop-blur-sm rounded-md px-2 py-1">
                                        <p className="text-[9px] text-white/80 font-medium">↔ Move mouse to preview</p>
                                    </div>
                                )}

                                {/* Style badge */}
                                <div className="absolute top-3 right-3 z-20 bg-violet-600/80 backdrop-blur-sm rounded-md px-2 py-1">
                                    <p className="text-[9px] text-white font-semibold uppercase tracking-wider">
                                        {style === 'kenburns' ? '● Ken Burns' : style === 'floatGlow' ? '● Float Glow' : '● Parallax'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Reduced motion notice */}
                    {prefersReducedMotion && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-[10px] text-amber-700 dark:text-amber-300">
                            ⚠ Your system has <strong>prefers-reduced-motion</strong> enabled — animations are paused in this preview. They will also be paused for visitors with the same setting.
                        </div>
                    )}

                    <p className="text-[10px] text-muted-foreground">
                        Animations respect <code className="text-[9px] bg-muted px-1 py-0.5 rounded">prefers-reduced-motion</code> and are disabled automatically.
                    </p>

                    {/* Unscoped keyframes — avoids styled-jsx hash suffix mismatch with inline style references */}
                    <style dangerouslySetInnerHTML={{ __html: keyframesCSS }} />
                </div>
            )}
        </div>
    )
}
