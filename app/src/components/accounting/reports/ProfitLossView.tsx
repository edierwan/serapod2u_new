'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import {
  TrendingUp, RefreshCw, Loader2, Calendar, Download, FileText,
  TrendingDown, MinusCircle,
} from 'lucide-react'

interface ProfitLossViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface PLAccount {
  code: string
  name: string
  amount: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function ProfitLossView({ userProfile }: ProfitLossViewProps) {
  const [income, setIncome] = useState<PLAccount[]>([])
  const [expenses, setExpenses] = useState<PLAccount[]>([])
  const [totalIncome, setTotalIncome] = useState(0)
  const [totalExpense, setTotalExpense] = useState(0)
  const [netPL, setNetPL] = useState(0)
  const [loading, setLoading] = useState(true)

  // Default: current year start to today
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (dateFrom) params.append('from', dateFrom)
      if (dateTo) params.append('to', dateTo)

      const res = await fetch(`/api/accounting/reports/profit-loss?${params}`)
      if (res.ok) {
        const data = await res.json()
        setIncome(data.income || [])
        setExpenses(data.expenses || [])
        setTotalIncome(data.totalIncome || 0)
        setTotalExpense(data.totalExpense || 0)
        setNetPL(data.netProfitLoss || 0)
      } else {
        toast({ title: 'Error', description: 'Failed to load P&L', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load P&L', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadReport() }, [loadReport])

  const handleExportCSV = () => {
    const lines: string[][] = []
    lines.push(['Profit & Loss Statement'])
    lines.push([`Period: ${dateFrom} to ${dateTo}`])
    lines.push([])
    lines.push(['INCOME'])
    lines.push(['Code', 'Account', 'Amount'])
    for (const a of income) lines.push([a.code, `"${a.name}"`, a.amount.toFixed(2)])
    lines.push(['', 'Total Income', totalIncome.toFixed(2)])
    lines.push([])
    lines.push(['EXPENSES'])
    lines.push(['Code', 'Account', 'Amount'])
    for (const a of expenses) lines.push([a.code, `"${a.name}"`, a.amount.toFixed(2)])
    lines.push(['', 'Total Expenses', totalExpense.toFixed(2)])
    lines.push([])
    lines.push(['', netPL >= 0 ? 'NET PROFIT' : 'NET LOSS', netPL.toFixed(2)])

    const csv = lines.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `profit-loss-${dateFrom}-to-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Income</span>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{formatCurrency(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Expenses</span>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300">{formatCurrency(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className={netPL >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MinusCircle className={`h-4 w-4 ${netPL >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
              <span className="text-xs font-medium text-muted-foreground">{netPL >= 0 ? 'Net Profit' : 'Net Loss'}</span>
            </div>
            <p className={`text-2xl font-bold ${netPL >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
              {formatCurrency(Math.abs(netPL))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                Profit & Loss Statement
              </CardTitle>
              <CardDescription>
                Income statement for the selected period.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-sm" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-sm" />
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={income.length === 0 && expenses.length === 0}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={loadReport} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            </div>
          ) : income.length === 0 && expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No income or expense entries for this period</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Income Section */}
              <div>
                <h3 className="text-sm font-semibold text-green-700 dark:text-green-300 mb-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> INCOME
                </h3>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-green-50/50 dark:bg-green-900/10">
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right w-40">Amount (MYR)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {income.map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="font-mono text-sm">{a.code}</TableCell>
                          <TableCell className="text-sm">{a.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-green-700">{formatCurrency(a.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-green-50/50 dark:bg-green-900/10 font-bold">
                        <TableCell colSpan={2} className="text-right font-bold">Total Income</TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-700">{formatCurrency(totalIncome)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Expense Section */}
              <div>
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" /> EXPENSES
                </h3>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-red-50/50 dark:bg-red-900/10">
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right w-40">Amount (MYR)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="font-mono text-sm">{a.code}</TableCell>
                          <TableCell className="text-sm">{a.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-red-700">{formatCurrency(a.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-red-50/50 dark:bg-red-900/10 font-bold">
                        <TableCell colSpan={2} className="text-right font-bold">Total Expenses</TableCell>
                        <TableCell className="text-right font-mono font-bold text-red-700">{formatCurrency(totalExpense)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Net P&L */}
              <Separator />
              <div className={`p-4 rounded-lg ${netPL >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{netPL >= 0 ? 'NET PROFIT' : 'NET LOSS'}</span>
                  <span className={`text-2xl font-bold font-mono ${netPL >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                    {formatCurrency(Math.abs(netPL))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
