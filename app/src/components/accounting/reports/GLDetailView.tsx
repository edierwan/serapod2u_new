'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
  FileText, RefreshCw, Loader2, Calendar, Download, Search, BookOpen,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

interface GLDetailViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface GLAccount {
  id: string
  code: string
  name: string
  account_type: string
}

interface GLDetailLine {
  journal_id: string
  journal_number: string
  journal_date: string
  description: string
  debit: number
  credit: number
  running_balance: number
  journal_status: string
  memo: string | null
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function GLDetailView({ userProfile }: GLDetailViewProps) {
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [lines, setLines] = useState<GLDetailLine[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalLines, setTotalLines] = useState(0)
  const [openingBalance, setOpeningBalance] = useState(0)

  // Default: current year start to today
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  // Load chart of accounts for the account picker
  useEffect(() => {
    async function loadAccounts() {
      try {
        setLoadingAccounts(true)
        const res = await fetch('/api/accounting/chart-of-accounts')
        if (res.ok) {
          const data = await res.json()
          const accts = (data.accounts || data || []).map((a: any) => ({
            id: a.id,
            code: a.code || a.account_code,
            name: a.name || a.account_name,
            account_type: a.account_type || '',
          }))
          setAccounts(accts)
        }
      } catch {
        // silent
      } finally {
        setLoadingAccounts(false)
      }
    }
    loadAccounts()
  }, [])

  const loadDetail = useCallback(async () => {
    if (!accountId) return
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('account_id', accountId)
      if (dateFrom) params.append('from', dateFrom)
      if (dateTo) params.append('to', dateTo)
      params.append('page', page.toString())
      params.append('per_page', '50')

      const res = await fetch(`/api/accounting/reports/gl-detail?${params}`)
      if (res.ok) {
        const data = await res.json()
        setLines(data.lines || [])
        setTotalPages(data.totalPages || 1)
        setTotalLines(data.total || 0)
        setOpeningBalance(data.openingBalance || 0)
      } else {
        toast({ title: 'Error', description: 'Failed to load GL detail', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load GL detail', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [accountId, dateFrom, dateTo, page])

  useEffect(() => {
    if (accountId) loadDetail()
  }, [accountId, loadDetail])

  const selectedAccount = accounts.find((a) => a.id === accountId)

  const filteredAccounts = accountSearch
    ? accounts.filter((a) =>
        a.code.toLowerCase().includes(accountSearch.toLowerCase()) ||
        a.name.toLowerCase().includes(accountSearch.toLowerCase())
      )
    : accounts

  const handleExportCSV = () => {
    if (!selectedAccount) return
    const csvLines: string[][] = []
    csvLines.push(['GL Detail Report'])
    csvLines.push([`Account: ${selectedAccount.code} - ${selectedAccount.name}`])
    csvLines.push([`Period: ${dateFrom} to ${dateTo}`])
    csvLines.push([])
    csvLines.push(['Date', 'Journal #', 'Description', 'Memo', 'Debit', 'Credit', 'Running Balance'])
    csvLines.push(['', '', 'Opening Balance', '', '', '', openingBalance.toFixed(2)])
    for (const l of lines) {
      csvLines.push([
        l.journal_date,
        l.journal_number,
        `"${l.description || ''}"`,
        `"${l.memo || ''}"`,
        l.debit > 0 ? l.debit.toFixed(2) : '',
        l.credit > 0 ? l.credit.toFixed(2) : '',
        l.running_balance.toFixed(2),
      ])
    }

    const csv = csvLines.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gl-detail-${selectedAccount.code}-${dateFrom}-to-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Account Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            GL Detail Report
          </CardTitle>
          <CardDescription>
            Transaction-level detail for a specific account with running balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Select Account</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code or name..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
              {loadingAccounts ? (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading accounts...
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  {filteredAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">No accounts found</p>
                  ) : (
                    filteredAccounts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { setAccountId(a.id); setPage(1) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-3 ${accountId === a.id ? 'bg-emerald-50 dark:bg-emerald-900/20 border-l-2 border-emerald-600' : ''}`}
                      >
                        <span className="font-mono text-xs w-16 shrink-0">{a.code}</span>
                        <span className="truncate">{a.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground capitalize">{a.account_type}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:w-56">
              <label className="text-xs font-medium text-muted-foreground">Date Range</label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="h-8 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 text-center">to</span>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="h-8 text-sm" />
              </div>
              <div className="flex gap-2 mt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={handleExportCSV} disabled={!accountId || lines.length === 0}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={loadDetail} disabled={!accountId || loading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Table */}
      {!accountId ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center">
              <Search className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">Select an account to view transaction detail</p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {selectedAccount?.code} — {selectedAccount?.name}
                </CardTitle>
                <CardDescription>
                  {totalLines} transaction{totalLines !== 1 ? 's' : ''} found · Period: {dateFrom} to {dateTo}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No transactions for this account in the selected period</p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/50 dark:bg-slate-900/10">
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead className="w-32">Journal #</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right w-32">Debit</TableHead>
                        <TableHead className="text-right w-32">Credit</TableHead>
                        <TableHead className="text-right w-36">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Opening balance row */}
                      <TableRow className="bg-muted/30 italic">
                        <TableCell className="text-sm">—</TableCell>
                        <TableCell className="text-sm">—</TableCell>
                        <TableCell className="text-sm font-medium">Opening Balance</TableCell>
                        <TableCell className="text-right text-sm">—</TableCell>
                        <TableCell className="text-right text-sm">—</TableCell>
                        <TableCell className="text-right font-mono text-sm font-bold">{formatCurrency(openingBalance)}</TableCell>
                      </TableRow>
                      {lines.map((l, i) => (
                        <TableRow key={`${l.journal_id}-${i}`}>
                          <TableCell className="text-sm">{formatDate(l.journal_date)}</TableCell>
                          <TableCell className="font-mono text-xs">{l.journal_number}</TableCell>
                          <TableCell className="text-sm">
                            {l.description}
                            {l.memo && <span className="text-xs text-muted-foreground ml-2">({l.memo})</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {l.debit > 0 ? formatCurrency(l.debit) : ''}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {l.credit > 0 ? formatCurrency(l.credit) : ''}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-medium ${l.running_balance < 0 ? 'text-red-600' : ''}`}>
                            {formatCurrency(l.running_balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-muted-foreground">
                      Page {page} of {totalPages} · {totalLines} total transactions
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
