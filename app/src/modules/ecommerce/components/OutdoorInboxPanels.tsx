'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, Search } from 'lucide-react'

interface ContactMessage {
    id: string
    name: string
    email: string
    message: string
    status: string
    created_at: string
}

interface Subscriber {
    id: string
    email: string
    source: string | null
    status: string | null
    created_at: string
    unsubscribed_at: string | null
}

function formatDate(value: string) {
    return new Date(value).toLocaleString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function useStaffList<T>(url: string, key: string) {
    const [rows, setRows] = useState<T[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        fetch(url)
            .then(async res => {
                const data = await res.json().catch(() => null)
                if (cancelled) return
                if (res.status === 401) throw new Error('Only Outdoor store staff can see this list.')
                if (!res.ok) throw new Error(data?.error || 'Could not load this list.')
                setRows(Array.isArray(data?.[key]) ? data[key] : [])
            })
            .catch(err => { if (!cancelled) setError(err.message || 'Could not load this list.') })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [url, key])

    return { rows, loading, error }
}

function PanelState({ loading, error, empty }: { loading: boolean; error: string | null; empty: string | null }) {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }
    if (error) return <p className="sera-sc-panel p-6 text-sm text-destructive">{error}</p>
    if (empty) return <p className="sera-sc-panel p-6 text-sm text-muted-foreground">{empty}</p>
    return null
}

/** Messages sent from the Outdoor store contact form. */
export function OutdoorMessagesPanel() {
    const { rows, loading, error } = useStaffList<ContactMessage>('/api/outdoor/contact?limit=100', 'messages')
    const [query, setQuery] = useState('')
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        return q ? rows.filter(m => `${m.name} ${m.email} ${m.message}`.toLowerCase().includes(q)) : rows
    }, [rows, query])

    const state = <PanelState loading={loading} error={error} empty={shown.length === 0 ? (query ? 'No messages match your search.' : 'No messages yet.') : null} />

    return (
        <div className="space-y-3">
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--sera-muted)]" />
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search by name, email or message…"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--sera-line)] rounded-lg bg-white"
                />
            </div>
            {loading || error || shown.length === 0 ? state : (
                <ul className="space-y-3">
                    {shown.map(m => (
                        <li key={m.id} className="sera-sc-panel p-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="font-medium text-foreground">{m.name}</p>
                                <p className="text-[11px] text-muted-foreground">{formatDate(m.created_at)}</p>
                            </div>
                            <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 text-xs text-[var(--sera-orange,#f97316)] hover:underline">
                                <Mail className="h-3 w-3" /> {m.email}
                            </a>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{m.message}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/** Outdoor newsletter sign-ups, active and unsubscribed. */
export function OutdoorSubscribersPanel() {
    const { rows, loading, error } = useStaffList<Subscriber>('/api/outdoor/updates?list=subscribers', 'subscribers')
    const [query, setQuery] = useState('')
    const active = rows.filter(s => (s.status || 'active') === 'active').length
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        return q ? rows.filter(s => s.email.toLowerCase().includes(q)) : rows
    }, [rows, query])

    const state = <PanelState loading={loading} error={error} empty={shown.length === 0 ? (query ? 'No subscribers match your search.' : 'No subscribers yet.') : null} />

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--sera-muted)]" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search by email…"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--sera-line)] rounded-lg bg-white"
                    />
                </div>
                {!loading && !error ? (
                    <p className="text-xs text-muted-foreground">
                        {active} active · {rows.length - active} unsubscribed
                    </p>
                ) : null}
            </div>
            {loading || error || shown.length === 0 ? state : (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-accent/30">
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Source</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Joined</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {shown.map(s => {
                                const isActive = (s.status || 'active') === 'active'
                                return (
                                    <tr key={s.id}>
                                        <td className="px-4 py-2.5 text-foreground break-all">{s.email}</td>
                                        <td className="px-4 py-2.5">
                                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                                                isActive
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                    : 'border-gray-200 bg-gray-50 text-gray-500'
                                            }`}>
                                                {isActive ? 'Active' : 'Unsubscribed'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{s.source || '—'}</td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(s.created_at)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
