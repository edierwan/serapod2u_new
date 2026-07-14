'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, ChevronDown, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReturnSourceType } from '@/lib/returns/constants'
import type { OrgRef } from '@/lib/returns/types'

interface ReturnSourceComboboxProps {
    sourceType: ReturnSourceType
    value: string | null
    /** Currently-selected org, used for display before/without a search result. */
    selectedOrg: OrgRef | null
    onSelect: (org: OrgRef) => void
    disabled?: boolean
}

const DEBOUNCE_MS = 350

/**
 * Searchable, server-side combobox for the Return From source (Shop or
 * Distributor). Type to search by name / code / branch / contact; results are
 * strictly filtered to the selected source type by the API.
 */
export function ReturnSourceCombobox({ sourceType, value, selectedOrg, onSelect, disabled }: ReturnSourceComboboxProps) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<OrgRef[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const noun = sourceType === 'distributor' ? 'distributors' : 'shops'
    const nounSingular = sourceType === 'distributor' ? 'distributor' : 'shop'

    const runSearch = useCallback(async (q: string) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({ type: sourceType })
            if (q) params.set('q', q)
            if (value) params.set('id', value)
            const res = await fetch(`/api/returns/organizations?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Search failed')
            setResults(json.organizations || [])
        } catch (e: any) {
            setError(`Unable to search ${noun}. Please try again.`)
            setResults([])
        } finally {
            setLoading(false)
        }
    }, [sourceType, value, noun])

    // Debounced search whenever the query changes while open.
    useEffect(() => {
        if (!open) return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => { void runSearch(query) }, DEBOUNCE_MS)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, open, runSearch])

    // Close on outside click.
    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
                setQuery('')
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const openPicker = () => {
        if (disabled) return
        setOpen(true)
        setResults([])
        // Load the initial (unfiltered) page immediately.
        void runSearch('')
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const pick = (org: OrgRef) => {
        onSelect(org)
        setOpen(false)
        setQuery('')
    }

    const triggerLabel = selectedOrg
        ? `${selectedOrg.org_name || 'Unnamed'}${selectedOrg.org_code ? ` (${selectedOrg.org_code})` : ''}`
        : `Select ${nounSingular}`

    return (
        <div ref={containerRef} className="relative">
            {!open ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={openPicker}
                    className={cn(
                        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
                        'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        disabled && 'cursor-not-allowed opacity-50',
                        !selectedOrg && 'text-muted-foreground',
                    )}
                >
                    <span className="truncate">{triggerLabel}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
            ) : (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${noun} by name, code, contact…`}
                        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    />
                    {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                </div>
            )}

            {open && (
                <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
                    {error ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-sm text-destructive">
                            <AlertTriangle className="h-4 w-4" /> {error}
                        </div>
                    ) : loading && results.length === 0 ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                        </div>
                    ) : results.length === 0 ? (
                        <div className="px-2 py-3 text-sm text-muted-foreground">
                            {sourceType === 'distributor' ? 'No matching distributors found.' : 'No matching shops found.'}
                        </div>
                    ) : (
                        results.map((org) => (
                            <button
                                key={org.id}
                                type="button"
                                onClick={() => pick(org)}
                                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            >
                                <Check className={cn('mt-0.5 h-4 w-4 shrink-0', org.id === value ? 'opacity-100' : 'opacity-0')} />
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                        {org.org_name || 'Unnamed'}
                                        {org.org_code && <span className="ml-1 text-xs text-muted-foreground">({org.org_code})</span>}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {[org.branch, org.contact_name, org.contact_phone].filter(Boolean).join(' · ') || 'No contact details'}
                                    </span>
                                </span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
