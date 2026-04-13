'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Store, X, Search, MapPin, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ShopResult {
    org_id: string
    org_name: string
    branch: string | null
    contact_name: string | null
    contact_phone: string | null
    state_name: string | null
    display_label: string
}

interface ShopPickerProps {
    value?: string | null          // current shop_name value (free text, backward compat)
    onSelect: (shop: ShopResult | null, displayName: string) => void
    disabled?: boolean
    placeholder?: string
    className?: string
    maxLength?: number
}

export function ShopPicker({
    value,
    onSelect,
    disabled = false,
    placeholder = 'Search shop by name...',
    className,
    maxLength = 50,
}: ShopPickerProps) {
    const [searchTerm, setSearchTerm] = useState(value || '')
    const [results, setResults] = useState<ShopResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [selectedShop, setSelectedShop] = useState<ShopResult | null>(null)
    const [showSelectionHint, setShowSelectionHint] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Sync external value
    useEffect(() => {
        if (!selectedShop && value !== searchTerm) {
            setSearchTerm(value || '')
            setShowSelectionHint(false)
        }
    }, [searchTerm, selectedShop, value])

    useEffect(() => {
        let cancelled = false

        const resolveExistingShop = async () => {
            const normalizedValue = (value || '').trim()
            if (!normalizedValue || selectedShop) return

            try {
                const res = await fetch(`/api/shops/search?q=${encodeURIComponent(normalizedValue)}&limit=10`)
                const data = await res.json()
                if (!data.success || cancelled) return

                const exactMatch = (data.results || []).find((shop: ShopResult) => {
                    const display = shop.display_label.trim().toLowerCase()
                    const orgName = shop.org_name.trim().toLowerCase()
                    return display === normalizedValue.toLowerCase() || orgName === normalizedValue.toLowerCase()
                })

                if (!exactMatch || cancelled) return

                setSelectedShop(exactMatch)
                setSearchTerm(exactMatch.display_label)
                setShowSelectionHint(false)
                onSelect(exactMatch, exactMatch.display_label)
            } catch (err) {
                console.error('Shop resolve error:', err)
            }
        }

        void resolveExistingShop()

        return () => {
            cancelled = true
        }
    }, [onSelect, selectedShop, value])

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
        if (!term || term.trim().length < 1) {
            setResults([])
            setIsOpen(false)
            return
        }

        setIsSearching(true)
        try {
            const res = await fetch(`/api/shops/search?q=${encodeURIComponent(term.trim())}&limit=10`)
            const data = await res.json()
            if (data.success) {
                setResults(data.results || [])
                setIsOpen(true)
            }
        } catch (err) {
            console.error('Shop search error:', err)
            setResults([])
        } finally {
            setIsSearching(false)
        }
    }, [])

    const handleInputChange = (val: string) => {
        if (val.length > maxLength) return
        setSearchTerm(val)
        setShowSelectionHint(Boolean(val.trim()))
        if (selectedShop) {
            setSelectedShop(null)
        }

        onSelect(null, val)

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        searchTimeoutRef.current = setTimeout(() => doSearch(val), 300)
    }

    const handleSelect = (shop: ShopResult) => {
        setSelectedShop(shop)
        setSearchTerm(shop.display_label)
        setIsOpen(false)
        setResults([])
        setShowSelectionHint(false)
        onSelect(shop, shop.display_label)
    }

    const handleClear = () => {
        setSelectedShop(null)
        setSearchTerm('')
        setResults([])
        setIsOpen(false)
        setShowSelectionHint(false)
        onSelect(null, '')
        inputRef.current?.focus()
    }

    // Cleanup
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        }
    }, [])

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <div className="relative">
                <Store className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                    ref={inputRef}
                    value={searchTerm}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onFocus={() => { if (results.length > 0) setIsOpen(true) }}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="h-9 text-sm pl-8 pr-8"
                    maxLength={maxLength}
                />
                <div className="absolute right-2 top-2 flex items-center gap-1">
                    {isSearching && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {(selectedShop || searchTerm) && !disabled && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
            {selectedShop && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <Store className="h-3 w-3" />
                    Linked to: {selectedShop.org_name}{selectedShop.branch ? ` (${selectedShop.branch})` : ''}
                    {selectedShop.state_name && ` · ${selectedShop.state_name}`}
                </p>
            )}
            {!selectedShop && showSelectionHint && searchTerm && (
                <p className="text-xs text-amber-600 mt-1">Please select a shop from the list below</p>
            )}

            {/* Dropdown results */}
            {isOpen && results.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg max-h-[240px] overflow-y-auto">
                    {results.map((shop) => (
                        <button
                            key={shop.org_id + (shop.branch || '')}
                            type="button"
                            className="w-full px-3 py-2.5 text-left hover:bg-accent transition-colors border-b last:border-b-0"
                            onClick={() => handleSelect(shop)}
                        >
                            <div className="flex items-center gap-2">
                                <Store className="w-4 h-4 text-orange-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {shop.org_name}
                                        {shop.branch && <span className="text-muted-foreground font-normal"> ({shop.branch})</span>}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        {shop.state_name && (
                                            <span className="inline-flex items-center gap-1">
                                                <MapPin className="w-3 h-3" />
                                                {shop.state_name}
                                            </span>
                                        )}
                                        {shop.contact_name && (
                                            <span className="truncate">{shop.contact_name}</span>
                                        )}
                                        {shop.contact_phone && (
                                            <span className="inline-flex items-center gap-1">
                                                <Phone className="w-3 h-3" />
                                                {shop.contact_phone}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 bg-orange-50 text-orange-700 border-orange-200">
                                    Shop
                                </Badge>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* No results */}
            {isOpen && !isSearching && results.length === 0 && searchTerm.trim().length >= 1 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg p-3 text-center">
                    <p className="text-sm text-muted-foreground">No shops found</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Try searching with a different name</p>
                </div>
            )}
        </div>
    )
}
