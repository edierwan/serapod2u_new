'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import {
  Building2, RefreshCw, Loader2, Calendar, Download, FileText,
  Landmark, Wallet, Scale,
} from 'lucide-react'

interface BalanceSheetViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface BSAccount {
  code: string
  name: string
  balance: number
}

interface BSSection {
  accounts: BSAccount[]
  total: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function BalanceSheetView({ userProfile }: BalanceSheetViewProps) {
  const [assets, setAssets] = useState<BSSection>({ accounts: [], total: 0 })
  const [liabilities, setLiabilities] = useState<BSSection>({ accounts: [], total: 0 })
  const [equity, setEquity] = useState<BSSection>({ accounts: [], total: 0 })
  const [retainedEarnings, setRetainedEarnings] = useState(0)
  const [loading, setLoading] = useState(true)

  // Default: as at today
  const [asAtDate, setAsAtDate] = useState(new Date().toISOString().split('T')[0])

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (asAtDate) params.append('as_at', asAtDate)

      const res = await fetch(`/api/accounting/reports/balance-sheet?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAssets(data.assets || { accounts: [], total: 0 })
        setLiabilities(data.liabilities || { accounts: [], total: 0 })
        setEquity(data.equity || { accounts: [], total: 0 })
        setRetainedEarnings(data.retainedEarnings || 0)
      } else {
        toast({ title: 'Error', description: 'Failed to load balance sheet', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load balance sheet', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [asAtDate])

  useEffect(() => { loadReport() }, [loadReport])

  const totalLiabilitiesEquity = liabilities.total + equity.total + retainedEarnings
  const isBalanced = Math.abs(assets.total - totalLiabilitiesEquity) < 0.01

  const handleExportCSV = () => {
    const lines: string[][] = []
    lines.push(['Balance Sheet'])
    lines.push([`As at: ${asAtDate}`])
    lines.push([])
    lines.push(['ASSETS'])
    lines.push(['Code', 'Account', 'Balance'])
    for (const a of assets.accounts) lines.push([a.code, `"${a.name}"`, a.balance.toFixed(2)])
    lines.push(['', 'Total Assets', assets.total.toFixed(2)])
    lines.push([])
    lines.push(['LIABILITIES'])
    lines.push(['Code', 'Account', 'Balance'])
    for (const a of liabilities.accounts) lines.push([a.code, `"${a.name}"`, a.balance.toFixed(2)])
    lines.push(['', 'Total Liabilities', liabilities.total.toFixed(2)])
    lines.push([])
    lines.push(['EQUITY'])
    lines.push(['Code', 'Account', 'Balance'])
    for (const a of equity.accounts) lines.push([a.code, `"${a.name}"`, a.balance.toFixed(2)])
    lines.push(['', 'Retained Earnings', retainedEarnings.toFixed(2)])
    lines.push(['', 'Total Equity', (equity.total + retainedEarnings).toFixed(2)])
    lines.push([])
    lines.push(['', 'Total L + E', totalLiabilitiesEquity.toFixed(2)])

    const csv = lines.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `balance-sheet-${asAtDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    section: BSSection,
    colorClass: string,
    bgClass: string,
    extra?: React.ReactNode
  ) => (
    <div>
      <h3 className={`text-sm font-semibold ${colorClass} mb-2 flex items-center gap-2`}>
        {icon} {title}
      </h3>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className={bgClass}>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right w-40">Balance (MYR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.accounts.map((a) => (
              <TableRow key={a.code}>
                <TableCell className="font-mono text-sm">{a.code}</TableCell>
                <TableCell className="text-sm">{a.name}</TableCell>
                <TableCell className="text-right font-mono text-sm font-medium">{formatCurrency(a.balance)}</TableCell>
              </TableRow>
            ))}
            {extra}
            <TableRow className={`${bgClass} font-bold`}>
              <TableCell colSpan={2} className="text-right font-bold">
                Total {title}
              </TableCell>
              <TableCell className="text-right font-mono font-bold">
                {formatCurrency(title === 'EQUITY' ? equity.total + retainedEarnings : section.total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Assets</span>
            </div>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(assets.total)}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 dark:border-orange-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-orange-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Liabilities</span>
            </div>
            <p className="text-xl font-bold text-orange-700 dark:text-orange-300">{formatCurrency(liabilities.total)}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 dark:border-purple-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Equity</span>
            </div>
            <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{formatCurrency(equity.total + retainedEarnings)}</p>
          </CardContent>
        </Card>
        <Card className={isBalanced ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Scale className={`h-4 w-4 ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`} />
              <span className="text-xs font-medium text-muted-foreground">Balance Check</span>
            </div>
            <p className={`text-xl font-bold ${isBalanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
              {isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
            </p>
            {!isBalanced && (
              <p className="text-xs text-red-600 mt-0.5">
                Diff: {formatCurrency(Math.abs(assets.total - totalLiabilitiesEquity))}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="h-5 w-5 text-emerald-600" />
                Balance Sheet
              </CardTitle>
              <CardDescription>
                Statement of financial position as at the selected date.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">As at</span>
              <Input type="date" value={asAtDate} onChange={(e) => setAsAtDate(e.target.value)} className="h-8 w-36 text-sm" />
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={assets.accounts.length === 0 && liabilities.accounts.length === 0 && equity.accounts.length === 0}>
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
          ) : assets.accounts.length === 0 && liabilities.accounts.length === 0 && equity.accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No GL entries found for this period</p>
            </div>
          ) : (
            <div className="space-y-6">
              {renderSection(
                'ASSETS',
                <Landmark className="h-4 w-4" />,
                assets,
                'text-blue-700 dark:text-blue-300',
                'bg-blue-50/50 dark:bg-blue-900/10'
              )}

              {renderSection(
                'LIABILITIES',
                <Wallet className="h-4 w-4" />,
                liabilities,
                'text-orange-700 dark:text-orange-300',
                'bg-orange-50/50 dark:bg-orange-900/10'
              )}

              {renderSection(
                'EQUITY',
                <Building2 className="h-4 w-4" />,
                equity,
                'text-purple-700 dark:text-purple-300',
                'bg-purple-50/50 dark:bg-purple-900/10',
                retainedEarnings !== 0 ? (
                  <TableRow>
                    <TableCell className="font-mono text-sm italic text-muted-foreground">—</TableCell>
                    <TableCell className="text-sm italic text-muted-foreground">Retained Earnings (auto-calculated)</TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium italic text-muted-foreground">{formatCurrency(retainedEarnings)}</TableCell>
                  </TableRow>
                ) : null
              )}

              <Separator />

              {/* Balanced check */}
              <div className={`p-4 rounded-lg ${isBalanced ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Assets</span>
                    <span className="font-mono font-bold">{formatCurrency(assets.total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Liabilities + Equity</span>
                    <span className="font-mono font-bold">{formatCurrency(totalLiabilitiesEquity)}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{isBalanced ? '✓ Statement is balanced' : '✗ Statement is NOT balanced'}</span>
                    {!isBalanced && (
                      <span className="font-mono font-bold text-red-700">
                        Difference: {formatCurrency(Math.abs(assets.total - totalLiabilitiesEquity))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
