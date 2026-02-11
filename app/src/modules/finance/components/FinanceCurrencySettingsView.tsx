'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import {
    DollarSign,
    Plus,
    Save,
    Loader2,
    Trash2,
    ArrowLeftRight,
    RefreshCw,
    Globe,
    Hash,
    Settings2,
} from 'lucide-react'
import { format } from 'date-fns'

interface FinanceCurrencySettingsViewProps {
    userProfile: {
        id: string
        organizations: {
            id: string
            org_type_code: string
        }
        roles: {
            role_level: number
        }
    }
}

interface CurrencySettings {
    base_currency_code: string
    base_currency_name: string
    base_currency_symbol: string
    decimal_places: number
    thousand_separator: string
    decimal_separator: string
    symbol_position: string
}

interface ExchangeRate {
    id: string
    company_id: string
    from_currency: string
    to_currency: string
    rate: number
    effective_date: string
    source: string
    created_at: string
}

const CURRENCIES = [
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'THB', name: 'Thai Baht', symbol: '฿' },
    { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
]

export default function FinanceCurrencySettingsView({ userProfile }: FinanceCurrencySettingsViewProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [currency, setCurrency] = useState<CurrencySettings>({
        base_currency_code: 'MYR',
        base_currency_name: 'Malaysian Ringgit',
        base_currency_symbol: 'RM',
        decimal_places: 2,
        thousand_separator: ',',
        decimal_separator: '.',
        symbol_position: 'before'
    })
    const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([])
    const [loadingRates, setLoadingRates] = useState(false)
    const [showAddRateDialog, setShowAddRateDialog] = useState(false)
    const [newRate, setNewRate] = useState({
        from_currency: '',
        to_currency: 'MYR',
        rate: '',
        effective_date: format(new Date(), 'yyyy-MM-dd'),
        source: 'manual'
    })
    const [savingRate, setSavingRate] = useState(false)

    const isAdmin = userProfile.roles?.role_level <= 20

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/accounting/system-settings')
            if (!res.ok) throw new Error('Failed to load settings')
            const data = await res.json()
            if (data.currency) {
                setCurrency(data.currency)
                setNewRate(prev => ({ ...prev, to_currency: data.currency.base_currency_code }))
            }
        } catch (err) {
            console.error(err)
            toast({ title: 'Error', description: 'Failed to load currency settings', variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [])

    const loadExchangeRates = useCallback(async () => {
        try {
            setLoadingRates(true)
            const res = await fetch('/api/accounting/exchange-rates')
            if (!res.ok) throw new Error('Failed to load rates')
            const data = await res.json()
            setExchangeRates(data.rates || [])
        } catch (err) {
            console.error(err)
        } finally {
            setLoadingRates(false)
        }
    }, [])

    useEffect(() => {
        loadSettings()
        loadExchangeRates()
    }, [loadSettings, loadExchangeRates])

    const handleSaveCurrency = async () => {
        if (!isAdmin) {
            toast({ title: 'Permission denied', description: 'Only HQ Admins can change currency settings', variant: 'destructive' })
            return
        }
        try {
            setSaving(true)
            const res = await fetch('/api/accounting/system-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currency)
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to save')
            }
            toast({ title: 'Saved', description: 'Currency settings updated successfully' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleCurrencySelect = (code: string) => {
        const curr = CURRENCIES.find(c => c.code === code)
        if (curr) {
            setCurrency(prev => ({
                ...prev,
                base_currency_code: curr.code,
                base_currency_name: curr.name,
                base_currency_symbol: curr.symbol,
            }))
        }
    }

    const handleAddRate = async () => {
        if (!newRate.from_currency || !newRate.rate || !newRate.effective_date) {
            toast({ title: 'Validation', description: 'Fill in all required fields', variant: 'destructive' })
            return
        }
        if (newRate.from_currency === newRate.to_currency) {
            toast({ title: 'Validation', description: 'From and To currency cannot be the same', variant: 'destructive' })
            return
        }
        try {
            setSavingRate(true)
            const res = await fetch('/api/accounting/exchange-rates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...newRate,
                    rate: parseFloat(newRate.rate)
                })
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to save')
            }
            toast({ title: 'Saved', description: 'Exchange rate added' })
            setShowAddRateDialog(false)
            setNewRate({
                from_currency: '',
                to_currency: currency.base_currency_code,
                rate: '',
                effective_date: format(new Date(), 'yyyy-MM-dd'),
                source: 'manual'
            })
            loadExchangeRates()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setSavingRate(false)
        }
    }

    const handleDeleteRate = async (id: string) => {
        if (!confirm('Delete this exchange rate?')) return
        try {
            const res = await fetch(`/api/accounting/exchange-rates?id=${id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Failed to delete')
            toast({ title: 'Deleted', description: 'Exchange rate removed' })
            loadExchangeRates()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        }
    }

    const formatPreview = (amount: number) => {
        const parts = amount.toFixed(currency.decimal_places).split('.')
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, currency.thousand_separator)
        const formatted = parts.length > 1 ? `${intPart}${currency.decimal_separator}${parts[1]}` : intPart
        return currency.symbol_position === 'before'
            ? `${currency.base_currency_symbol} ${formatted}`
            : `${formatted} ${currency.base_currency_symbol}`
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* ─── Base Currency Settings ─── */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <DollarSign className="h-5 w-5 text-blue-600" />
                                Base Currency
                            </CardTitle>
                            <CardDescription>
                                Set your company&apos;s base (functional) currency. All GL journals and reports will use this currency.
                            </CardDescription>
                        </div>
                        {isAdmin && (
                            <Button onClick={handleSaveCurrency} disabled={saving} className="gap-2">
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save Currency
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Currency Selection */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                                Currency
                            </Label>
                            <Select
                                value={currency.base_currency_code}
                                onValueChange={handleCurrencySelect}
                                disabled={!isAdmin}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map(c => (
                                        <SelectItem key={c.code} value={c.code}>
                                            <span className="flex items-center gap-2">
                                                <span className="font-mono text-sm w-8">{c.code}</span>
                                                <span>{c.name}</span>
                                                <span className="text-muted-foreground ml-auto">{c.symbol}</span>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Symbol Position */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-muted-foreground" />
                                Symbol Position
                            </Label>
                            <Select
                                value={currency.symbol_position}
                                onValueChange={(v) => setCurrency(prev => ({ ...prev, symbol_position: v }))}
                                disabled={!isAdmin}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="before">Before amount (RM 1,000.00)</SelectItem>
                                    <SelectItem value="after">After amount (1,000.00 RM)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Decimal Places */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Hash className="h-4 w-4 text-muted-foreground" />
                                Decimal Places
                            </Label>
                            <Select
                                value={String(currency.decimal_places)}
                                onValueChange={(v) => setCurrency(prev => ({ ...prev, decimal_places: parseInt(v) }))}
                                disabled={!isAdmin}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">0 (1,000)</SelectItem>
                                    <SelectItem value="2">2 (1,000.00)</SelectItem>
                                    <SelectItem value="3">3 (1,000.000)</SelectItem>
                                    <SelectItem value="4">4 (1,000.0000)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Separators */}
                        <div className="space-y-2">
                            <Label>Number Format</Label>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs text-muted-foreground">Thousand Separator</Label>
                                    <Select
                                        value={currency.thousand_separator}
                                        onValueChange={(v) => setCurrency(prev => ({ ...prev, thousand_separator: v }))}
                                        disabled={!isAdmin}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value=",">Comma (1,000)</SelectItem>
                                            <SelectItem value=".">Period (1.000)</SelectItem>
                                            <SelectItem value=" ">Space (1 000)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Decimal Separator</Label>
                                    <Select
                                        value={currency.decimal_separator}
                                        onValueChange={(v) => setCurrency(prev => ({ ...prev, decimal_separator: v }))}
                                        disabled={!isAdmin}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value=".">Period (.)</SelectItem>
                                            <SelectItem value=",">Comma (,)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                        <Label className="text-sm font-medium">Format Preview</Label>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">Small:</span>{' '}
                                <span className="font-mono font-medium">{formatPreview(42.5)}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Medium:</span>{' '}
                                <span className="font-mono font-medium">{formatPreview(1234.56)}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Large:</span>{' '}
                                <span className="font-mono font-medium">{formatPreview(1500000)}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ─── Exchange Rates ─── */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <ArrowLeftRight className="h-5 w-5 text-green-600" />
                                Exchange Rates
                            </CardTitle>
                            <CardDescription>
                                Manage exchange rates for multi-currency transactions. Rates are relative to your base currency ({currency.base_currency_code}).
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={loadExchangeRates} disabled={loadingRates}>
                                <RefreshCw className={`h-4 w-4 mr-1 ${loadingRates ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                            {isAdmin && (
                                <Button size="sm" onClick={() => setShowAddRateDialog(true)} className="gap-1">
                                    <Plus className="h-4 w-4" />
                                    Add Rate
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {exchangeRates.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No exchange rates configured yet.</p>
                            <p className="text-xs mt-1">Add rates if you transact in foreign currencies.</p>
                        </div>
                    ) : (
                        <div className="rounded-md border overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-medium">From</th>
                                        <th className="text-left px-4 py-2 font-medium">To</th>
                                        <th className="text-right px-4 py-2 font-medium">Rate</th>
                                        <th className="text-left px-4 py-2 font-medium">Effective Date</th>
                                        <th className="text-left px-4 py-2 font-medium">Source</th>
                                        {isAdmin && <th className="text-right px-4 py-2 font-medium w-16"></th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {exchangeRates.map(rate => (
                                        <tr key={rate.id} className="hover:bg-muted/30 transition-colors">
                                            <td className="px-4 py-2">
                                                <Badge variant="outline" className="font-mono">{rate.from_currency}</Badge>
                                            </td>
                                            <td className="px-4 py-2">
                                                <Badge variant="outline" className="font-mono">{rate.to_currency}</Badge>
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono font-medium">
                                                {Number(rate.rate).toFixed(6)}
                                            </td>
                                            <td className="px-4 py-2 text-muted-foreground">
                                                {format(new Date(rate.effective_date), 'dd MMM yyyy')}
                                            </td>
                                            <td className="px-4 py-2">
                                                <Badge variant="secondary" className="text-xs capitalize">{rate.source}</Badge>
                                            </td>
                                            {isAdmin && (
                                                <td className="px-4 py-2 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                                        onClick={() => handleDeleteRate(rate.id)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ─── Add Exchange Rate Dialog ─── */}
            <Dialog open={showAddRateDialog} onOpenChange={setShowAddRateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ArrowLeftRight className="h-5 w-5" />
                            Add Exchange Rate
                        </DialogTitle>
                        <DialogDescription>
                            Enter the exchange rate relative to {currency.base_currency_code}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>From Currency</Label>
                                <Select
                                    value={newRate.from_currency}
                                    onValueChange={(v) => setNewRate(prev => ({ ...prev, from_currency: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CURRENCIES
                                            .filter(c => c.code !== newRate.to_currency)
                                            .map(c => (
                                                <SelectItem key={c.code} value={c.code}>
                                                    {c.code} – {c.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>To Currency</Label>
                                <Select
                                    value={newRate.to_currency}
                                    onValueChange={(v) => setNewRate(prev => ({ ...prev, to_currency: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CURRENCIES.map(c => (
                                            <SelectItem key={c.code} value={c.code}>
                                                {c.code} – {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Exchange Rate</Label>
                            <Input
                                type="number"
                                step="0.000001"
                                min="0"
                                placeholder="e.g. 4.450000"
                                value={newRate.rate}
                                onChange={(e) => setNewRate(prev => ({ ...prev, rate: e.target.value }))}
                            />
                            {newRate.from_currency && newRate.rate && (
                                <p className="text-xs text-muted-foreground">
                                    1 {newRate.from_currency} = {Number(newRate.rate).toFixed(6)} {newRate.to_currency}
                                </p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Effective Date</Label>
                                <Input
                                    type="date"
                                    value={newRate.effective_date}
                                    onChange={(e) => setNewRate(prev => ({ ...prev, effective_date: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Source</Label>
                                <Select
                                    value={newRate.source}
                                    onValueChange={(v) => setNewRate(prev => ({ ...prev, source: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual">Manual</SelectItem>
                                        <SelectItem value="BNM">BNM (Bank Negara)</SelectItem>
                                        <SelectItem value="market">Market Rate</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddRateDialog(false)}>Cancel</Button>
                        <Button onClick={handleAddRate} disabled={savingRate}>
                            {savingRate ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                            Add Rate
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
