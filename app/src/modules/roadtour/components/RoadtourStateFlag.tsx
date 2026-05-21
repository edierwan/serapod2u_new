'use client'

import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { getStateFlagPath } from '@/lib/roadtour/visit-region'
import { cn } from '@/lib/utils'

type RoadtourStateFlagProps = {
    stateName?: string | null
    size?: 'sm' | 'md'
    fallback?: 'none' | 'placeholder' | 'badge'
    className?: string
}

const SIZE_CLASSES = {
    sm: {
        container: 'h-4 w-4',
        icon: 'h-2.5 w-2.5',
        badge: 'text-xs',
    },
    md: {
        container: 'h-7 w-7',
        icon: 'h-3.5 w-3.5',
        badge: 'text-xs',
    },
} as const

export function RoadtourStateFlag({ stateName, size = 'sm', fallback = 'none', className }: RoadtourStateFlagProps) {
    const [imageFailed, setImageFailed] = useState(false)

    useEffect(() => {
        setImageFailed(false)
    }, [stateName])

    const resolvedStateName = typeof stateName === 'string' ? stateName.trim() : ''
    const flagPath = getStateFlagPath(resolvedStateName)
    const sizeClass = SIZE_CLASSES[size]

    if (flagPath && !imageFailed) {
        return (
            <img
                src={flagPath}
                alt=""
                aria-label={resolvedStateName ? `${resolvedStateName} flag` : 'State flag'}
                title={resolvedStateName || 'State flag'}
                className={cn(
                    'rounded-full border border-slate-200 bg-white object-cover shrink-0',
                    sizeClass.container,
                    className,
                )}
                onError={() => setImageFailed(true)}
            />
        )
    }

    if (fallback === 'badge' && resolvedStateName) {
        return (
            <Badge
                variant="outline"
                title={resolvedStateName}
                aria-label={resolvedStateName}
                className={cn(sizeClass.badge, className)}
            >
                {resolvedStateName}
            </Badge>
        )
    }

    if (fallback !== 'placeholder') return null

    return (
        <span
            title={resolvedStateName || 'State unavailable'}
            aria-label={resolvedStateName ? `${resolvedStateName} flag unavailable` : 'State unavailable'}
            className={cn(
                'flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 shrink-0',
                sizeClass.container,
                className,
            )}
        >
            <MapPin className={sizeClass.icon} />
        </span>
    )
}