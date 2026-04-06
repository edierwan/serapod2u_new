'use client'

import { useState, useCallback } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Loader2, Phone, Mail, AlertTriangle, Users, User } from 'lucide-react'

interface Recipient {
    user_id: string
    full_name: string
    email: string | null
    phone: string | null
    type: string
}

interface PreviewData {
    recipients: Recipient[]
    total: number
    hasPhone: number
    missingPhone: number
}

interface RecipientsPreviewPopoverProps {
    /** Badge label to show as trigger */
    label: string
    /** Query parameters for the preview API */
    queryParams: Record<string, string>
    /** Badge variant styling */
    variant?: 'roles' | 'dynamic' | 'users' | 'consumer'
}

export function RecipientsPreviewPopover({
    label,
    queryParams,
    variant = 'roles',
}: RecipientsPreviewPopoverProps) {
    const [data, setData] = useState<PreviewData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [open, setOpen] = useState(false)

    const fetchPreview = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams(queryParams)
            const res = await fetch(`/api/notifications/recipients/preview?${params}`)
            if (!res.ok) throw new Error('Failed to load')
            const json = await res.json()
            if (json.success) {
                setData(json)
            } else {
                setError(json.error || 'Failed to load recipients')
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [queryParams])

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen)
        if (isOpen && !data) {
            fetchPreview()
        }
    }

    const variantStyles = {
        roles: 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 cursor-pointer',
        dynamic: 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 cursor-pointer',
        users: 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 cursor-pointer',
        consumer: 'bg-white border-blue-200 text-blue-700 hover:bg-white',
    }

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Badge
                    variant="secondary"
                    className={`${variantStyles[variant]} transition-colors`}
                >
                    {label}
                </Badge>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 p-0"
                side="bottom"
                align="start"
                sideOffset={6}
            >
                {/* Header */}
                <div className="px-4 py-3 border-b bg-gray-50/80">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                            <Users className="w-4 h-4 text-gray-500" />
                            Recipients Preview
                        </h4>
                        {data && (
                            <span className="text-xs font-semibold text-gray-700 bg-gray-200 px-2 py-0.5 rounded-full">
                                {data.hasPhone}/{data.total}
                            </span>
                        )}
                    </div>
                    {data && (
                        <div className="flex items-center gap-3 mt-1.5 text-xs">
                            <span className="flex items-center gap-1 text-green-700">
                                <Phone className="w-3 h-3" />
                                {data.hasPhone} {data.hasPhone === 1 ? 'has' : 'have'} contact
                            </span>
                            {data.missingPhone > 0 && (
                                <span className="flex items-center gap-1 text-amber-700">
                                    <AlertTriangle className="w-3 h-3" />
                                    {data.missingPhone} contact not updated
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Body */}
                <div className="max-h-[280px] overflow-y-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-8 text-gray-400">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            <span className="text-sm">Loading recipients...</span>
                        </div>
                    )}

                    {error && (
                        <div className="px-4 py-6 text-center text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {data && data.recipients.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-gray-400">
                            No recipients found
                        </div>
                    )}

                    {data && data.recipients.map((r) => (
                        <div
                            key={r.user_id}
                            className="flex items-start gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-gray-50/50 transition-colors"
                        >
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                                <User className="w-3.5 h-3.5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 truncate">
                                        {r.full_name}
                                    </span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0 font-normal text-gray-500">
                                        {r.type.replace('Role: ', '')}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5">
                                    {r.phone ? (
                                        <span className="flex items-center gap-1 text-xs text-green-700">
                                            <Phone className="w-3 h-3" />
                                            {r.phone}
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-xs text-amber-600">
                                            <Phone className="w-3 h-3" />
                                            No phone
                                        </span>
                                    )}
                                    {r.email && (
                                        <span className="flex items-center gap-1 text-xs text-gray-500 truncate">
                                            <Mail className="w-3 h-3 shrink-0" />
                                            <span className="truncate">{r.email}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer: note if any orgs returned no users */}
                {data && data.total === 0 && (
                    <div className="px-4 py-2 border-t bg-gray-50/80 text-xs text-gray-500 text-center">
                        No users found for this selection.
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
