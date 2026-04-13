'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, UserCheck, X, Search, Phone, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReferenceUser {
    user_id: string
    full_name: string
    phone: string
    email: string
    organization_name?: string | null
}

interface ReferencePickerProps {
    value?: string | null           // current referral_phone value (backward compat)
    referenceUserId?: string | null // new: direct user_id if available
    onSelect: (ref: ReferenceUser | null, phone: string) => void
    disabled?: boolean
    placeholder?: string
    className?: string
}

export function ReferencePicker({
    value,
    referenceUserId,
    onSelect,
    disabled = false,
    placeholder = 'Search by name, phone, or email...',
    className,
}: ReferencePickerProps) {
    const [searchTerm, setSearchTerm] = useState('')
    const [results, setResults] = useState<ReferenceUser[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [selectedRef, setSelectedRef] = useState<ReferenceUser | null>(null)
    const [resolvedName, setResolvedName] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Resolve initial value to a display name
    useEffect(() => {
        if (value && !selectedRef) {
            // Try to resolve the existing referral_phone to a name
            const resolveExisting = async () => {
                try {
                    const res = await fetch(`/api/reference/search?q=${encodeURIComponent(value)}&limit=5`)
                    const data = await res.json()
                    if (data.success && data.results?.length > 0) {
                        // Find exact match by phone
                        const match = data.results.find((r: ReferenceUser) =>
                            r.phone === value || r.phone?.replace(/\D/g, '') === value?.replace(/\D/g, '')
                        )
                        if (match) {
                            setSelectedRef(match)
                            setResolvedName(match.full_name)
                        } else {
                            setResolvedName(null)
                        }
                    }
                } catch {
                    // Silently fail - just show raw value
                }
            }
            resolveExisting()
        }
    }, [value])

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const doSearch = useCallback(async (term: string) => {
        if (!term || term.length < 2) {
            setResults([])
            setIsOpen(false)
            return
        }

        setIsSearching(true)
        try {
            const res = await fetch(`/api/reference/search?q=${encodeURIComponent(term)}&limit=10`)
            const data = await res.json()
            if (data.success) {
                setResults(data.results || [])
                setIsOpen(true)
            }
        } catch (err) {
            console.error('Reference search error:', err)
            setResults([])
        } finally {
            setIsSearching(false)
        }
    }, [])

    const handleInputChange = (val: string) => {
        setSearchTerm(val)
        if (selectedRef) {
            setSelectedRef(null)
            setResolvedName(null)
        }

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        searchTimeoutRef.current = setTimeout(() => doSearch(val), 300)
    }

    const handleSelect = (ref: ReferenceUser) => {
        setSelectedRef(ref)
        setResolvedName(ref.full_name)
        setSearchTerm('')
        setIsOpen(false)
        setResults([])
        onSelect(ref, ref.phone)
    }

    const handleClear = () => {
        setSelectedRef(null)
        setResolvedName(null)
        setSearchTerm('')
        setResults([])
        setIsOpen(false)
        onSelect(null, '')
        inputRef.current?.focus()
    }

    // Cleanup
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        }
    }, [])

    const displayValue = selectedRef
        ? selectedRef.full_name
        : resolvedName || value || ''

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            {selectedRef || resolvedName ? (
                // Selected state: show badge with clear button
                <div className="flex items-center gap-2 p-2 border rounded-md bg-green-50 border-green-200 min-h-[36px]">
                    <UserCheck className="w-4 h-4 text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-green-800 truncate">
                            {displayValue}
                        </div>
                        <div className="text-xs text-green-600 truncate">
                            {selectedRef?.phone || value}
                        </div>
                    </div>
                    {!disabled && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 text-green-600 hover:text-red-500 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            ) : (
                // Search state
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                        ref={inputRef}
                        value={searchTerm}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onFocus={() => { if (results.length > 0) setIsOpen(true) }}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="h-9 text-sm pl-8 pr-8"
                    />
                    {isSearching && (
                        <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                </div>
            )}

            {/* Dropdown results */}
            {isOpen && results.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg max-h-[240px] overflow-y-auto">
                    {results.map((ref) => (
                        <button
                            key={ref.user_id}
                            type="button"
                            className="w-full px-3 py-2.5 text-left hover:bg-accent transition-colors border-b last:border-b-0"
                            onClick={() => handleSelect(ref)}
                        >
                            <div className="flex items-center gap-2">
                                <UserCheck className="w-4 h-4 text-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{ref.full_name}</div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                            <Phone className="w-3 h-3" />
                                            {ref.phone}
                                        </span>
                                        {ref.email && (
                                            <span className="inline-flex items-center gap-1 truncate">
                                                <Mail className="w-3 h-3" />
                                                {ref.email}
                                            </span>
                                        )}
                                    </div>
                                    {ref.organization_name && (
                                        <div className="text-xs text-muted-foreground/70 mt-0.5">{ref.organization_name}</div>
                                    )}
                                </div>
                                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                                    Reference
                                </Badge>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* No results message */}
            {isOpen && !isSearching && results.length === 0 && searchTerm.length >= 2 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg p-3 text-center">
                    <p className="text-sm text-muted-foreground">No eligible references found</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Only users marked as eligible references appear here</p>
                </div>
            )}
        </div>
    )
}
