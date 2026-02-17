'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    ArrowLeft,
    Loader2,
    Search,
    ShoppingBag,
    Package,
    Truck,
    CheckCircle2,
    XCircle,
    Clock,
    CreditCard,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Eye,
    X,
    Mail,
    Phone,
    MapPin,
    Calendar,
    DollarSign,
    AlertCircle,
    Filter,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface StorefrontOrderItem {
    id: string
    order_id: string
    variant_id: string | null
    product_name: string
    variant_name: string
    quantity: number
    unit_price: number
    subtotal: number
    created_at: string
}

interface StorefrontOrder {
    id: string
    order_ref: string
    status: string
    customer_name: string
    customer_email: string
    customer_phone: string
    shipping_address: {
        line1?: string
        line2?: string
        city?: string
        state?: string
        postcode?: string
    }
    total_amount: number
    currency: string
    payment_provider: string | null
    payment_ref: string | null
    paid_at: string | null
    organization_id: string | null
    created_at: string
    updated_at: string
    storefront_order_items: StorefrontOrderItem[]
}

interface StoreOrdersViewProps {
    userProfile: any
    onViewChange: (view: string) => void
}

// ── Status config ─────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, {
    label: string
    color: string
    bgColor: string
    icon: typeof Clock
}> = {
    pending_payment: {
        label: 'Pending Payment',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800',
        icon: Clock,
    },
    paid: {
        label: 'Paid',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800',
        icon: CreditCard,
    },
    payment_failed: {
        label: 'Payment Failed',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800',
        icon: XCircle,
    },
    processing: {
        label: 'Processing',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
        icon: Package,
    },
    shipped: {
        label: 'Shipped',
        color: 'text-indigo-600 dark:text-indigo-400',
        bgColor: 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800',
        icon: Truck,
    },
    delivered: {
        label: 'Delivered',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800',
        icon: CheckCircle2,
    },
    cancelled: {
        label: 'Cancelled',
        color: 'text-gray-500 dark:text-gray-400',
        bgColor: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
        icon: XCircle,
    },
    refunded: {
        label: 'Refunded',
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800',
        icon: RefreshCw,
    },
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
    pending_payment: ['paid', 'cancelled'],
    paid: ['processing', 'cancelled', 'refunded'],
    payment_failed: ['pending_payment', 'cancelled'],
    processing: ['shipped', 'cancelled', 'refunded'],
    shipped: ['delivered', 'refunded'],
    delivered: ['refunded'],
    cancelled: [],
    refunded: [],
}

// ── Helpers ──────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'MYR') {
    return new Intl.NumberFormat('en-MY', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
    }).format(amount)
}

function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-MY', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function formatShortDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

// ── Component ─────────────────────────────────────────────────────

export default function StoreOrdersView({ userProfile, onViewChange }: StoreOrdersViewProps) {
    const [orders, setOrders] = useState<StorefrontOrder[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [totalOrders, setTotalOrders] = useState(0)
    const [selectedOrder, setSelectedOrder] = useState<StorefrontOrder | null>(null)
    const [updatingStatus, setUpdatingStatus] = useState(false)

    // ── Debounce search ──────────────────────────────────────────

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
            setPage(1)
        }, 400)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // ── Fetch orders ─────────────────────────────────────────────

    const fetchOrders = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)

            const params = new URLSearchParams()
            params.set('page', String(page))
            params.set('limit', '25')
            if (statusFilter !== 'all') params.set('status', statusFilter)
            if (debouncedSearch) params.set('search', debouncedSearch)

            const res = await fetch(`/api/admin/store/orders?${params.toString()}`)
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.error || 'Failed to fetch orders')
            }

            const data = await res.json()
            setOrders(data.orders || [])
            setTotalPages(data.totalPages || 1)
            setTotalOrders(data.total || 0)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [page, statusFilter, debouncedSearch])

    useEffect(() => { fetchOrders() }, [fetchOrders])

    // ── Update order status ──────────────────────────────────────

    const handleStatusUpdate = async (orderId: string, newStatus: string) => {
        if (!confirm(`Change order status to "${STATUS_CONFIG[newStatus]?.label || newStatus}"?`)) return

        setUpdatingStatus(true)
        setError(null)

        try {
            const res = await fetch('/api/admin/store/orders', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: orderId, status: newStatus }),
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.error || 'Failed to update order')
            }

            const data = await res.json()
            // Update local state
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...data.order, storefront_order_items: o.storefront_order_items } : o))
            if (selectedOrder?.id === orderId) {
                setSelectedOrder(prev => prev ? { ...prev, ...data.order, storefront_order_items: prev.storefront_order_items } : null)
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setUpdatingStatus(false)
        }
    }

    // ── Status summary counts ────────────────────────────────────

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        orders.forEach(o => {
            counts[o.status] = (counts[o.status] || 0) + 1
        })
        return counts
    }, [orders])

    // ── Render status badge ──────────────────────────────────────

    const renderStatusBadge = (status: string, size: 'sm' | 'md' = 'sm') => {
        const config = STATUS_CONFIG[status] || {
            label: status,
            color: 'text-gray-500',
            bgColor: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
            icon: AlertCircle,
        }
        const Icon = config.icon
        const sizeClasses = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'

        return (
            <span className={`inline-flex items-center gap-1 ${sizeClasses} font-medium rounded-full border ${config.bgColor} ${config.color}`}>
                <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                {config.label}
            </span>
        )
    }

    // ── Order detail panel ───────────────────────────────────────

    const renderOrderDetail = () => {
        if (!selectedOrder) return null

        const transitions = STATUS_TRANSITIONS[selectedOrder.status] || []
        const addr = selectedOrder.shipping_address || {}

        return (
            <div className="fixed inset-0 z-50 flex items-start justify-end">
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={() => setSelectedOrder(null)}
                />

                {/* Panel */}
                <div className="relative w-full max-w-lg h-full bg-card border-l border-border shadow-2xl overflow-y-auto animate-in slide-in-from-right-5 duration-200">
                    {/* Header */}
                    <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-4 flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold text-base text-foreground">{selectedOrder.order_ref}</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Created {formatDate(selectedOrder.created_at)}
                            </p>
                        </div>
                        <button
                            onClick={() => setSelectedOrder(null)}
                            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="p-5 space-y-5">
                        {/* Status */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                            <div className="flex items-center gap-3 flex-wrap">
                                {renderStatusBadge(selectedOrder.status, 'md')}
                                {transitions.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground">→</span>
                                        {transitions.map(nextStatus => (
                                            <button
                                                key={nextStatus}
                                                onClick={() => handleStatusUpdate(selectedOrder.id, nextStatus)}
                                                disabled={updatingStatus}
                                                className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-border hover:bg-accent hover:border-violet-300 dark:hover:border-violet-700 transition-colors disabled:opacity-50"
                                            >
                                                {STATUS_CONFIG[nextStatus]?.label || nextStatus}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Customer info */}
                        <div className="bg-accent/40 rounded-xl p-4 space-y-2.5">
                            <h3 className="text-sm font-semibold text-foreground">Customer</h3>
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium text-foreground">{selectedOrder.customer_name}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Mail className="h-3 w-3 shrink-0" />
                                    <span>{selectedOrder.customer_email}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Phone className="h-3 w-3 shrink-0" />
                                    <span>{selectedOrder.customer_phone}</span>
                                </div>
                                {(addr.line1 || addr.city) && (
                                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                        <span>
                                            {[addr.line1, addr.line2, addr.city, addr.state, addr.postcode]
                                                .filter(Boolean)
                                                .join(', ')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Payment info */}
                        <div className="bg-accent/40 rounded-xl p-4 space-y-2.5">
                            <h3 className="text-sm font-semibold text-foreground">Payment</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="text-[11px] text-muted-foreground">Amount</span>
                                    <p className="text-sm font-semibold text-foreground">
                                        {formatCurrency(selectedOrder.total_amount, selectedOrder.currency)}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[11px] text-muted-foreground">Provider</span>
                                    <p className="text-sm text-foreground capitalize">
                                        {selectedOrder.payment_provider || '—'}
                                    </p>
                                </div>
                                {selectedOrder.payment_ref && (
                                    <div>
                                        <span className="text-[11px] text-muted-foreground">Reference</span>
                                        <p className="text-sm font-mono text-foreground">{selectedOrder.payment_ref}</p>
                                    </div>
                                )}
                                {selectedOrder.paid_at && (
                                    <div>
                                        <span className="text-[11px] text-muted-foreground">Paid At</span>
                                        <p className="text-sm text-foreground">{formatDate(selectedOrder.paid_at)}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Order items */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">
                                Items ({selectedOrder.storefront_order_items?.length || 0})
                            </h3>
                            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                                {(selectedOrder.storefront_order_items || []).map((item) => (
                                    <div key={item.id} className="p-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-foreground truncate">{item.product_name}</p>
                                            <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-medium text-foreground">
                                                {formatCurrency(item.subtotal, selectedOrder.currency)}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                                {item.quantity} × {formatCurrency(item.unit_price, selectedOrder.currency)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                                {/* Total row */}
                                <div className="p-3 bg-accent/40 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-foreground">Total</span>
                                    <span className="text-sm font-bold text-foreground">
                                        {formatCurrency(selectedOrder.total_amount, selectedOrder.currency)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Timestamps */}
                        <div className="text-[11px] text-muted-foreground space-y-1 py-2 border-t border-border">
                            <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                Created: {formatDate(selectedOrder.created_at)}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                Updated: {formatDate(selectedOrder.updated_at)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // ── Main render ──────────────────────────────────────────────

    return (
        <div className="w-full max-w-6xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onViewChange('customer-growth')}
                        className="p-2 rounded-lg hover:bg-accent transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Store Orders</h1>
                        <p className="text-sm text-muted-foreground">
                            View and manage online storefront orders
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchOrders}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-4 py-3 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by order ref, name, or email…"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-shadow"
                    />
                </div>

                {/* Status filter */}
                <div className="flex items-center gap-1.5">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
                        className="text-sm border border-border rounded-lg bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                    >
                        <option value="all">All Statuses</option>
                        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                            <option key={key} value={key}>{config.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Summary cards */}
            {!loading && orders.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-card border border-border rounded-xl p-3">
                        <p className="text-[11px] text-muted-foreground font-medium">Total Orders</p>
                        <p className="text-lg font-bold text-foreground mt-0.5">{totalOrders}</p>
                    </div>
                    <div className="bg-card border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Pending Payment</p>
                        <p className="text-lg font-bold text-foreground mt-0.5">{statusCounts['pending_payment'] || 0}</p>
                    </div>
                    <div className="bg-card border border-blue-200 dark:border-blue-800/50 rounded-xl p-3">
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">Processing</p>
                        <p className="text-lg font-bold text-foreground mt-0.5">{statusCounts['processing'] || 0}</p>
                    </div>
                    <div className="bg-card border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-3">
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Delivered</p>
                        <p className="text-lg font-bold text-foreground mt-0.5">{statusCounts['delivered'] || 0}</p>
                    </div>
                </div>
            )}

            {/* Orders table */}
            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : orders.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                    <h3 className="font-semibold text-foreground mb-1">No orders found</h3>
                    <p className="text-sm text-muted-foreground mb-1">
                        {statusFilter !== 'all' || debouncedSearch
                            ? 'Try adjusting your filters or search query.'
                            : 'Orders from your online storefront will appear here.'}
                    </p>
                </div>
            ) : (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-accent/30">
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Order</th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Customer</th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Items</th>
                                    <th className="text-center px-4 py-3 font-medium text-muted-foreground"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {orders.map((order) => (
                                    <tr
                                        key={order.id}
                                        className="hover:bg-accent/20 transition-colors cursor-pointer"
                                        onClick={() => setSelectedOrder(order)}
                                    >
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-xs font-medium text-foreground">
                                                {order.order_ref}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="min-w-0">
                                                <p className="font-medium text-foreground truncate max-w-[180px]">
                                                    {order.customer_name}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                                                    {order.customer_email}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {renderStatusBadge(order.status)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="font-semibold text-foreground">
                                                {formatCurrency(order.total_amount, order.currency)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-xs text-muted-foreground">
                                                {formatShortDate(order.created_at)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="text-xs text-muted-foreground">
                                                {order.storefront_order_items?.length || 0}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSelectedOrder(order) }}
                                                className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                                                title="View details"
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {orders.map((order) => (
                            <button
                                key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                className="w-full bg-card border border-border rounded-xl p-4 text-left hover:border-violet-200 dark:hover:border-violet-800 transition-all"
                            >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div>
                                        <span className="font-mono text-xs font-medium text-foreground">
                                            {order.order_ref}
                                        </span>
                                        <p className="text-sm font-medium text-foreground mt-1">
                                            {order.customer_name}
                                        </p>
                                    </div>
                                    {renderStatusBadge(order.status)}
                                </div>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{formatShortDate(order.created_at)}</span>
                                    <span className="font-semibold text-foreground">
                                        {formatCurrency(order.total_amount, order.currency)}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                            <p className="text-xs text-muted-foreground">
                                Page {page} of {totalPages} • {totalOrders} orders total
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="p-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                    className="p-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Order detail slide-over panel */}
            {renderOrderDetail()}
        </div>
    )
}
