'use client'

import { useState } from 'react'
import { Map, BarChart3, QrCode, ClipboardList, Users, Settings } from 'lucide-react'
import { roadtourNavGroups } from '../roadtourNav'

interface RoadtourLandingViewProps {
    userProfile: any
    onViewChange: (viewId: string) => void
}

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'rt-campaigns': { bg: 'bg-blue-50', text: 'text-blue-700', hoverBorder: 'hover:border-blue-300' },
    'rt-field': { bg: 'bg-emerald-50', text: 'text-emerald-700', hoverBorder: 'hover:border-emerald-300' },
    'rt-analytics': { bg: 'bg-amber-50', text: 'text-amber-700', hoverBorder: 'hover:border-amber-300' },
}

export function RoadtourLandingView({ userProfile, onViewChange }: RoadtourLandingViewProps) {
    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-700 p-5 sm:p-8 text-white">
                <div className="flex items-center gap-3 opacity-80 text-sm mb-2">
                    <Map className="h-5 w-5" />
                    ROADTOUR MODULE
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">ROADTOUR</h1>
                <p className="mt-2 text-blue-100 max-w-2xl text-sm sm:text-base">
                    Plan road tour campaigns, assign account managers, generate QR codes, track field visits,
                    capture surveys, and monitor performance across your shop network.
                </p>
            </div>

            <p className="text-muted-foreground text-sm sm:text-base">
                Plan road tour campaigns, assign account managers, generate QR codes, track field visits, and monitor performance.
            </p>

            <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {roadtourNavGroups.map((group) => {
                    const accent = cardAccents[group.id] || { bg: 'bg-gray-50', text: 'text-gray-700', hoverBorder: 'hover:border-gray-300' }
                    const Icon = group.icon
                    return (
                        <div
                            key={group.id}
                            className={`bg-card border rounded-xl p-6 transition-all ${accent.hoverBorder}`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`rounded-lg p-2 ${accent.bg}`}>
                                    <Icon className={`h-5 w-5 ${accent.text}`} />
                                </div>
                                <h2 className="text-lg font-semibold">{group.label}</h2>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">{group.description}</p>
                            <ul className="space-y-2">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    return (
                                        <li key={child.id}>
                                            <button
                                                onClick={() => onViewChange(child.id)}
                                                className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors w-full text-left py-1"
                                            >
                                                <ChildIcon className="h-4 w-4 text-muted-foreground" />
                                                <span>{child.label}</span>
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
