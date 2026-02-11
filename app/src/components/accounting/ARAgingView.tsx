'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
  BarChart3, RefreshCw, Loader2, Calendar, Download, TrendingUp, AlertTriangle,
} from 'lucide-react'

interface ARAgingViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface AgingRow {
  customer_id: string
  customer_name: string
  current: number
  days_31_60: number
  days_61_90: number
  days_91_120: number
  days_120_plus: number
  total: number
  invoice_count: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function ARAgingView({ userProfile }: ARAgingViewProps) {
  const [aging, setAging] = useState<AgingRow[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [asAtDate, setAsAtDate] = useState(new Date().toISOString().split('T')[0])

  const loadAging = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/accounting/ar/aging?asAt=${asAtDate}`)
      if (res.ok) {
        const data = await res.json()
        setAging(data.aging || [])
        setTotals(data.totals || null)
      } else {
        toast({ title: 'Error', description: 'Failed to load AR aging', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load AR aging', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [asAtDate])

  useEffect(() => { loadAging() }, [loadAging])

  const handleExportCSV = () => {
    const headers = ['Customer', 'Invoices', 'Current', '31-60', '61-90', '91-120', '120+', 'Total']
    const rows = aging.map((r) => [
      r.customer_name, r.invoice_count,
      r.current.toFixed(2), r.days_31_60.toFixed(2), r.days_61_90.toFixed(2),
      r.days_91_120.toFixed(2), r.days_120_plus.toFixed(2), r.total.toFixed(2),
    ])
    if (totals) {
      rows.push([
        'TOTAL', totals.invoice_count,
        totals.current.toFixed(2), totals.days_31_60.toFixed(2), totals.days_61_90.toFixed(2),
        totals.days_91_120.toFixed(2), totals.days_120_plus.toFixed(2), totals.total.toFixed(2),
      ])
    }
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ar-aging-${asAtDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Current (0-30d)', value: totals?.current || 0, color: 'text-green-700' },
          { label: '31-60 Days', value: totals?.days_31_60 || 0, color: 'text-yellow-700' },
          { label: '61-90 Days', value: totals?.days_61_90 || 0, color: 'text-orange-700' },
          { label: '91-120 Days', value: totals?.days_91_120 || 0, color: 'text-red-600' },
          { label: '120+ Days', value: totals?.days_120_plus || 0, color: 'text-red-800' },
        ].map((bucket) => (
          <Card key={bucket.label}>
            <CardContent className="p-4">
              <span className="text-xs font-medium text-muted-foreground">{bucket.label}</span>
              <p className={`text-xl font-bold ${bucket.color} mt-1`}>{formatCurrency(bucket.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-sky-600" />
                Accounts Receivable Aging
              </CardTitle>
              <CardDescription>
                Outstanding customer balances by age bucket. Total: {formatCurrency(totals?.total || 0)} across {aging.length} customers.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={asAtDate}
                  onChange={(e) => setAsAtDate(e.target.value)}
                  className="h-8 w-36 text-sm"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={aging.length === 0}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={loadAging} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            </div>
          ) : aging.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <TrendingUp className="h-12 w-12 text-green-500 mb-3" />
              <p className="text-green-700 dark:text-green-300 font-semibold">No outstanding receivables</p>
              <p className="text-sm text-muted-foreground mt-1">All customer invoices are fully paid.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center">Invoices</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">31-60</TableHead>
                    <TableHead className="text-right">61-90</TableHead>
                    <TableHead className="text-right">91-120</TableHead>
                    <TableHead className="text-right">120+</TableHead>
                    <TableHead className="text-right font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aging.map((row) => (
                    <TableRow key={row.customer_id}>
                      <TableCell className="font-medium text-sm">{row.customer_name}</TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">{row.invoice_count}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row.current > 0 ? formatCurrency(row.current) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row.days_31_60 > 0 ? formatCurrency(row.days_31_60) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row.days_61_90 > 0 ? formatCurrency(row.days_61_90) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-600">{row.days_91_120 > 0 ? formatCurrency(row.days_91_120) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-700 font-medium">{row.days_120_plus > 0 ? formatCurrency(row.days_120_plus) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  {totals && (
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell className="font-bold">TOTAL</TableCell>
                      <TableCell className="text-center">{totals.invoice_count}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totals.current)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totals.days_31_60)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totals.days_61_90)}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{formatCurrency(totals.days_91_120)}</TableCell>
                      <TableCell className="text-right font-mono text-red-700">{formatCurrency(totals.days_120_plus)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totals.total)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Aging warning */}
          {totals && totals.days_120_plus > 0 && (
            <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                <strong>{formatCurrency(totals.days_120_plus)}</strong> outstanding over 120 days. Consider credit control follow-up.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
