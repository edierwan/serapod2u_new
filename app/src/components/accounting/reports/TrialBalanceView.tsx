'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
  Calculator, RefreshCw, Loader2, Calendar, Download, FileText,
  CheckCircle2, AlertCircle,
} from 'lucide-react'

interface TrialBalanceViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface TBRow {
  account_id: string
  code: string
  name: string
  account_type: string
  total_debit: number
  total_credit: number
  debit_balance: number
  credit_balance: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ASSET: 'bg-blue-50 text-blue-700 border-blue-200',
  LIABILITY: 'bg-red-50 text-red-700 border-red-200',
  EQUITY: 'bg-purple-50 text-purple-700 border-purple-200',
  INCOME: 'bg-green-50 text-green-700 border-green-200',
  EXPENSE: 'bg-orange-50 text-orange-700 border-orange-200',
}

export default function TrialBalanceView({ userProfile }: TrialBalanceViewProps) {
  const [rows, setRows] = useState<TBRow[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [accountTypeFilter, setAccountTypeFilter] = useState('all')

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (dateFrom) params.append('from', dateFrom)
      if (dateTo) params.append('to', dateTo)
      if (accountTypeFilter !== 'all') params.append('accountType', accountTypeFilter)

      const res = await fetch(`/api/accounting/reports/trial-balance?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRows(data.trialBalance || [])
        setTotals(data.totals || null)
      } else {
        toast({ title: 'Error', description: 'Failed to load trial balance', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load trial balance', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, accountTypeFilter])

  useEffect(() => { loadReport() }, [loadReport])

  const isBalanced = totals && Math.abs(totals.debit_balance - totals.credit_balance) < 0.01

  const handleExportCSV = () => {
    const headers = ['Code', 'Account Name', 'Type', 'Total Debit', 'Total Credit', 'Debit Balance', 'Credit Balance']
    const csvRows = rows.map((r) => [
      r.code, `"${r.name}"`, r.account_type,
      r.total_debit.toFixed(2), r.total_credit.toFixed(2),
      r.debit_balance.toFixed(2), r.credit_balance.toFixed(2),
    ])
    if (totals) {
      csvRows.push([
        '', 'TOTAL', '',
        totals.total_debit.toFixed(2), totals.total_credit.toFixed(2),
        totals.debit_balance.toFixed(2), totals.credit_balance.toFixed(2),
      ])
    }
    const csv = [headers, ...csvRows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trial-balance-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="h-5 w-5 text-violet-600" />
                Trial Balance
              </CardTitle>
              <CardDescription>
                Aggregate debit and credit balances per GL account.
                {totals && (
                  <span className="ml-2">
                    {isBalanced ? (
                      <span className="text-green-600 inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Balanced
                      </span>
                    ) : (
                      <span className="text-red-600 inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Out of balance by {formatCurrency(Math.abs(totals.debit_balance - totals.credit_balance))}
                      </span>
                    )}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={rows.length === 0}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={loadReport} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 mb-5 p-3 bg-muted/50 rounded-lg border">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-sm" placeholder="From" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-sm" placeholder="To" />
            <div className="w-40">
              <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Account Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ASSET">Asset</SelectItem>
                  <SelectItem value="LIABILITY">Liability</SelectItem>
                  <SelectItem value="EQUITY">Equity</SelectItem>
                  <SelectItem value="INCOME">Income</SelectItem>
                  <SelectItem value="EXPENSE">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No journal entries found for this period</p>
              <p className="text-sm text-muted-foreground mt-1">Post documents to GL to see the trial balance.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="text-right w-36">Debit (MYR)</TableHead>
                    <TableHead className="text-right w-36">Credit (MYR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.account_id}>
                      <TableCell className="font-mono text-sm">{row.code}</TableCell>
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${ACCOUNT_TYPE_COLORS[row.account_type] || ''}`}>
                          {row.account_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.debit_balance > 0 ? formatCurrency(row.debit_balance) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.credit_balance > 0 ? formatCurrency(row.credit_balance) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {totals && (
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell colSpan={3} className="text-right font-bold">TOTAL</TableCell>
                      <TableCell className="text-right font-mono font-bold">{formatCurrency(totals.debit_balance)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{formatCurrency(totals.credit_balance)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
