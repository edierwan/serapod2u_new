'use client'

import { useState, useEffect, useMemo } from 'react'
import { Settings } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

interface SettingsHeroBannerProps {
    /** User full name from auth profile */
    userName: string | null
}

// ── Greeting helper ──────────────────────────────────────────────

function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) return 'Good Morning'
    if (hour >= 12 && hour < 18) return 'Good Afternoon'
    return 'Good Evening'
}

// ── Component ────────────────────────────────────────────────────

export default function SettingsHeroBanner({ userName }: SettingsHeroBannerProps) {
    // Client-side greeting (hydration-safe)
    const [greeting, setGreeting] = useState('Welcome')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        setGreeting(getGreeting())

        // Update greeting every minute
        const interval = setInterval(() => setGreeting(getGreeting()), 60_000)
        return () => clearInterval(interval)
    }, [])

    // Determine first name only for cleaner display
    const firstName = useMemo(() => {
        if (!userName) return 'User'
        const parts = userName.trim().split(' ')
        return parts[0]
    }, [userName])

    return (
        <div className="relative w-full rounded-xl overflow-hidden mb-6" style={{ minHeight: 160 }}>
            {/* Default gradient background — slate/zinc for Settings */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-600 to-zinc-700" />

            {/* Overlay gradient for text readability */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/30 to-transparent" />

            {/* Decorative shapes */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -right-10 -top-10 w-64 h-64 bg-white/5 rounded-full" />
                <div className="absolute right-20 bottom-0 w-40 h-40 bg-white/5 rounded-full" />
                <div className="absolute left-1/2 -bottom-6 w-32 h-32 bg-white/5 rounded-full" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col justify-center px-6 md:px-8 py-8 md:py-10 h-[160px] md:h-[200px]">
                <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-white/20 backdrop-blur-sm">
                        <Settings className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-white/80 text-sm font-medium tracking-wide uppercase">
                        Settings
                    </span>
                </div>

                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight">
                    {mounted ? greeting : 'Welcome'}
                </h1>
                <p className="text-lg md:text-xl text-white/90 font-medium mt-1">
                    {firstName}
                </p>
            </div>
        </div>
    )
}
