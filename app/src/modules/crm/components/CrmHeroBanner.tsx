'use client'

import { useState, useEffect, useMemo } from 'react'
import { HeadphonesIcon } from 'lucide-react'

interface CrmHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) return 'Good Morning'
    if (hour >= 12 && hour < 18) return 'Good Afternoon'
    return 'Good Evening'
}

export default function CrmHeroBanner({ userName, bannerImageUrl }: CrmHeroBannerProps) {
    const [greeting, setGreeting] = useState('Welcome')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        setGreeting(getGreeting())
        const interval = setInterval(() => setGreeting(getGreeting()), 60_000)
        return () => clearInterval(interval)
    }, [])

    const firstName = useMemo(() => {
        if (!userName) return 'User'
        return userName.trim().split(' ')[0]
    }, [userName])

    return (
        <div className="relative w-full rounded-xl overflow-hidden mb-6" style={{ minHeight: 160 }}>
            {bannerImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bannerImageUrl} alt="CRM Banner" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-teal-600 via-cyan-500 to-sky-500" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/30 to-transparent" />
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -right-10 -top-10 w-64 h-64 bg-white/5 rounded-full" />
                <div className="absolute right-20 bottom-0 w-40 h-40 bg-white/5 rounded-full" />
                <div className="absolute left-1/2 -bottom-6 w-32 h-32 bg-white/5 rounded-full" />
            </div>
            <div className="relative z-10 flex flex-col justify-center px-6 md:px-8 py-8 md:py-10 h-[160px] md:h-[200px]">
                <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-white/20 backdrop-blur-sm">
                        <HeadphonesIcon className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-white/80 text-sm font-medium tracking-wide uppercase">
                        CRM Module
                    </span>
                </div>
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight">
                    CRM
                </h1>
                <p className="text-sm md:text-base text-white/90 font-medium mt-1">
                    Customer activity, support conversations, and engagement insights.
                </p>
            </div>
        </div>
    )
}
