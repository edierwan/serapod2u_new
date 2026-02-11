'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import {
  TrendingUp, TrendingDown, RefreshCw, Loader2, Calendar,
  ArrowUpRight, ArrowDownRight, Wallet, Landmark, BarChart3,
  DollarSign, ArrowRight, Download, Minus, Building2,
} from 'lucide-react'

interface CashFlowViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface CashFlowData {
  summary: {
    opening_balance: number
    total_inflows: number
    total_outflows: number
    net_change: number
    closing_balance: number
  }
  by_account: { account_code: string; account_name: string; inflows: number; outflows: number; net: number }[]
  by_category: {
    operating: { inflows: number; outflows: number; net: number }
    investing: { inflows: number; outflows: number; net: number }
    financing: { inflows: number; outflows: number; net: number }
  }
  bank_accounts: { id: string; account_name: string; bank_name: string; current_balance: number }[]
  period: { from: string; to: string }
  movement_count: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount)
}

function getMonthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const to = now.toISOString().slice(0, 10)
  return { from, to }
}

export default function CashFlowView({ userProfile }: CashFlowViewProps) {
  const defaults = getMonthRange()
  const [data, setData] = useState<CashFlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ from: dateFrom, to: dateTo })
      const res = await fetch(`/api/accounting/cash/cashflow?${params}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      } else {
        toast({ title: 'Error', description: 'Failed to load cash flow data', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load cash flow data', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  const handleExportCSV = () => {
    if (!data) return
    const { summary, by_category } = data
    const lines = [
      ['Cash Flow Statement', `${dateFrom} to ${dateTo}`],
      [],
      ['Opening Balance', '', formatCurrency(summary.opening_balance)],
      [],
      ['Operating Activities'],
      ['  Inflows', '', formatCurrency(by_category.operating.inflows)],
      ['  Outflows', '', formatCurrency(by_category.operating.outflows)],
      ['  Net Operating', '', formatCurrency(by_category.operating.net)],
      [],
      ['Investing Activities'],
      ['  Inflows', '', formatCurrency(by_category.investing.inflows)],
      ['  Outflows', '', formatCurrency(by_category.investing.outflows)],
      ['  Net Investing', '', formatCurrency(by_category.investing.net)],
      [],
      ['Financing Activities'],
      ['  Inflows', '', formatCurrency(by_category.financing.inflows)],
      ['  Outflows', '', formatCurrency(by_category.financing.outflows)],
      ['  Net Financing', '', formatCurrency(by_category.financing.net)],
      [],
      ['Net Change in Cash', '', formatCurrency(summary.net_change)],
      ['Closing Balance', '', formatCurrency(summary.closing_balance)],
    ]
    const csv = lines.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cashflow-${dateFrom}-to-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const s = data?.summary
  const cat = data?.by_category

  return (
    <div className="space-y-6">
      {/* Date Controls */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                Cash Flow Analysis
              </CardTitle>
              <CardDescription>
                Track money flowing in and out of your bank accounts across operating, investing, and financing activities.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!data}>
                <Download className="h-4 w-4 mr-1.5" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg border">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-sm" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-sm" />
            <div className="flex gap-1 ml-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                const now = new Date()
                setDateFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
                setDateTo(now.toISOString().slice(0, 10))
              }}>This Month</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                const now = new Date()
                setDateFrom(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10))
                setDateTo(now.toISOString().slice(0, 10))
              }}>YTD</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">No cash flow data available for this period.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cash Flow Waterfall */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-muted-foreground">Opening</span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(s?.opening_balance || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpRight className="h-4 w-4 text-green-600" />
                  <span className="text-xs font-medium text-muted-foreground">Total Inflows</span>
                </div>
                <p className="text-xl font-bold text-green-700 dark:text-green-300">+{formatCurrency(s?.total_inflows || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownRight className="h-4 w-4 text-red-600" />
                  <span className="text-xs font-medium text-muted-foreground">Total Outflows</span>
                </div>
                <p className="text-xl font-bold text-red-700 dark:text-red-300">-{formatCurrency(s?.total_outflows || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  {(s?.net_change || 0) >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
                  <span className="text-xs font-medium text-muted-foreground">Net Change</span>
                </div>
                <p className={`text-xl font-bold ${(s?.net_change || 0) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {formatCurrency(s?.net_change || 0)}
                </p>
              </CardContent>
            </Card>
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Closing Balance</span>
                </div>
                <p className="text-xl font-bold text-blue-700 dark:text-blue-200">{formatCurrency(s?.closing_balance || 0)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Activity Categories */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Operating */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Operating Activities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowUpRight className="h-3.5 w-3.5 text-green-600" /> Inflows
                  </span>
                  <span className="font-mono font-medium text-green-700">+{formatCurrency(cat?.operating.inflows || 0)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowDownRight className="h-3.5 w-3.5 text-red-600" /> Outflows
                  </span>
                  <span className="font-mono font-medium text-red-700">-{formatCurrency(cat?.operating.outflows || 0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center text-sm">
                  <span className="font-medium">Net</span>
                  <span className={`font-mono font-bold ${(cat?.operating.net || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(cat?.operating.net || 0)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Investing */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Investing Activities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowUpRight className="h-3.5 w-3.5 text-green-600" /> Inflows
                  </span>
                  <span className="font-mono font-medium text-green-700">+{formatCurrency(cat?.investing.inflows || 0)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowDownRight className="h-3.5 w-3.5 text-red-600" /> Outflows
                  </span>
                  <span className="font-mono font-medium text-red-700">-{formatCurrency(cat?.investing.outflows || 0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center text-sm">
                  <span className="font-medium">Net</span>
                  <span className={`font-mono font-bold ${(cat?.investing.net || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(cat?.investing.net || 0)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Financing */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Financing Activities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowUpRight className="h-3.5 w-3.5 text-green-600" /> Inflows
                  </span>
                  <span className="font-mono font-medium text-green-700">+{formatCurrency(cat?.financing.inflows || 0)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ArrowDownRight className="h-3.5 w-3.5 text-red-600" /> Outflows
                  </span>
                  <span className="font-mono font-medium text-red-700">-{formatCurrency(cat?.financing.outflows || 0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center text-sm">
                  <span className="font-medium">Net</span>
                  <span className={`font-mono font-bold ${(cat?.financing.net || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(cat?.financing.net || 0)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bank Account Balances */}
          {data.bank_accounts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  Bank Account Balances
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.bank_accounts.map((ba) => (
                    <div key={ba.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                      <Landmark className="h-5 w-5 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ba.bank_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{ba.account_name}</p>
                      </div>
                      <p className="font-mono text-sm font-bold shrink-0">{formatCurrency(parseFloat(String(ba.current_balance)) || 0)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-Account Breakdown */}
          {data.by_account.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <BarChart3 className="h-4 w-4 text-blue-600" />
                  Cash Movement by GL Account
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left p-3 font-medium">Account</th>
                        <th className="text-right p-3 font-medium text-green-700">Inflows</th>
                        <th className="text-right p-3 font-medium text-red-700">Outflows</th>
                        <th className="text-right p-3 font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_account.map((row) => (
                        <tr key={row.account_code} className="border-b last:border-0">
                          <td className="p-3">
                            <span className="font-mono text-xs text-muted-foreground mr-2">{row.account_code}</span>
                            {row.account_name}
                          </td>
                          <td className="p-3 text-right font-mono text-green-700">+{formatCurrency(row.inflows)}</td>
                          <td className="p-3 text-right font-mono text-red-700">-{formatCurrency(row.outflows)}</td>
                          <td className={`p-3 text-right font-mono font-bold ${row.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatCurrency(row.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {data.movement_count} journal {data.movement_count === 1 ? 'entry' : 'entries'} in period
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
