'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import {
  FileCheck2, RefreshCw, Loader2, Plus, CheckCircle2, Clock,
  Calendar, ArrowRightLeft, ChevronDown, ChevronUp, XCircle,
  AlertTriangle, Scale, FileText, Save, X, Landmark,
} from 'lucide-react'

interface BankReconciliationViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface Reconciliation {
  id: string
  bank_account_id: string
  bank_account_label: string
  period_start: string
  period_end: string
  statement_balance: number
  book_balance: number
  difference: number
  status: string
  reconciled_at: string | null
  notes: string | null
  created_at: string
}

interface ReconLine {
  id: string
  reconciliation_id: string
  transaction_date: string
  description: string
  reference: string | null
  debit_amount: number
  credit_amount: number
  source: string
  matched: boolean
  matched_journal_id: string | null
  created_at: string
}

interface BankAccount {
  id: string
  account_name: string
  bank_name: string
  current_balance: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount)
}

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function BankReconciliationView({ userProfile }: BankReconciliationViewProps) {
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedLines, setExpandedLines] = useState<ReconLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // New reconciliation form
  const [newForm, setNewForm] = useState({
    bank_account_id: '',
    period_start: '',
    period_end: '',
    statement_balance: '',
    notes: '',
  })

  // Add line form
  const [showAddLine, setShowAddLine] = useState(false)
  const [lineForm, setLineForm] = useState({
    transaction_date: '',
    description: '',
    reference: '',
    debit_amount: '0',
    credit_amount: '0',
    source: 'statement',
  })

  const loadReconciliations = useCallback(async () => {
    try {
      setLoading(true)
      const [reconRes, bankRes] = await Promise.all([
        fetch('/api/accounting/cash/reconciliation'),
        fetch('/api/accounting/cash/bank-accounts'),
      ])

      if (reconRes.ok) {
        const data = await reconRes.json()
        setReconciliations(data.reconciliations || [])
      }
      if (bankRes.ok) {
        const data = await bankRes.json()
        setBankAccounts(data.accounts || [])
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load reconciliations', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadReconciliations() }, [loadReconciliations])

  const handleCreate = async () => {
    if (!newForm.bank_account_id || !newForm.period_start || !newForm.period_end || !newForm.statement_balance) {
      toast({ title: 'Validation Error', description: 'All fields are required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/accounting/cash/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      if (res.ok) {
        toast({ title: 'Success', description: 'Reconciliation created' })
        setShowNew(false)
        setNewForm({ bank_account_id: '', period_start: '', period_end: '', statement_balance: '', notes: '' })
        loadReconciliations()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error || 'Failed to create', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create reconciliation', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleExpand = async (reconId: string) => {
    if (expandedId === reconId) {
      setExpandedId(null)
      setExpandedLines([])
      return
    }
    setExpandedId(reconId)
    setLinesLoading(true)
    // Lines are fetched as part of the reconciliation detail — for now we re-fetch
    // In a full implementation this would be a separate /api/.../{id}/lines endpoint
    // For MVP, we'll show the reconciliation details
    setExpandedLines([])
    setLinesLoading(false)
  }

  const handleComplete = async (reconId: string) => {
    try {
      const res = await fetch('/api/accounting/cash/reconciliation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reconId, action: 'complete' }),
      })
      if (res.ok) {
        toast({ title: 'Success', description: 'Reconciliation completed' })
        loadReconciliations()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to complete', variant: 'destructive' })
    }
  }

  const handleVoid = async (reconId: string) => {
    try {
      const res = await fetch('/api/accounting/cash/reconciliation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reconId, action: 'void' }),
      })
      if (res.ok) {
        toast({ title: 'Voided', description: 'Reconciliation voided' })
        loadReconciliations()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to void', variant: 'destructive' })
    }
  }

  const handleAddLine = async (reconId: string) => {
    if (!lineForm.transaction_date || !lineForm.description) {
      toast({ title: 'Validation', description: 'Date and description are required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/accounting/cash/reconciliation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: reconId,
          action: 'add_lines',
          lines: [{
            transaction_date: lineForm.transaction_date,
            description: lineForm.description,
            reference: lineForm.reference || null,
            debit_amount: parseFloat(lineForm.debit_amount) || 0,
            credit_amount: parseFloat(lineForm.credit_amount) || 0,
            source: lineForm.source,
          }],
        }),
      })
      if (res.ok) {
        toast({ title: 'Line Added', description: 'Reconciliation line added' })
        setShowAddLine(false)
        setLineForm({ transaction_date: '', description: '', reference: '', debit_amount: '0', credit_amount: '0', source: 'statement' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add line', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'completed': return 'bg-green-100 text-green-700 border-green-200'
      case 'in_progress': return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'void': return 'bg-red-100 text-red-700 border-red-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const draftCount = reconciliations.filter(r => r.status === 'draft' || r.status === 'in_progress').length
  const completedCount = reconciliations.filter(r => r.status === 'completed').length
  const totalDifference = reconciliations.filter(r => r.status !== 'void').reduce((s, r) => s + Math.abs(parseFloat(String(r.difference)) || 0), 0)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileCheck2 className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-medium text-muted-foreground">Reconciliations</span>
            </div>
            <p className="text-2xl font-bold">{reconciliations.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-orange-600" />
              <span className="text-xs font-medium text-muted-foreground">In Progress</span>
            </div>
            <p className="text-2xl font-bold text-orange-700">{draftCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-xs font-medium text-muted-foreground">Completed</span>
            </div>
            <p className="text-2xl font-bold text-green-700">{completedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Differences</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{formatCurrency(totalDifference)}</p>
          </CardContent>
        </Card>
      </div>

      {/* New Reconciliation Form */}
      {showNew && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="h-5 w-5 text-blue-600" />
              New Reconciliation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Bank Account *</Label>
                <select
                  value={newForm.bank_account_id}
                  onChange={(e) => setNewForm({ ...newForm, bank_account_id: e.target.value })}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Select Bank Account —</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.bank_name} - {b.account_name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Period Start *</Label>
                <Input type="date" value={newForm.period_start} onChange={(e) => setNewForm({ ...newForm, period_start: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Period End *</Label>
                <Input type="date" value={newForm.period_end} onChange={(e) => setNewForm({ ...newForm, period_end: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Statement Balance (per bank) *</Label>
                <Input type="number" step="0.01" value={newForm.statement_balance} onChange={(e) => setNewForm({ ...newForm, statement_balance: e.target.value })} className="h-9" placeholder="0.00" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-medium">Notes</Label>
                <Input value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} className="h-9" placeholder="Optional notes" />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5">
              <Button onClick={handleCreate} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>
                <X className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation List */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="h-5 w-5 text-blue-600" />
                Bank Reconciliations
              </CardTitle>
              <CardDescription>
                Match bank statement balances against book balances. Identify and resolve discrepancies.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Reconciliation
              </Button>
              <Button variant="outline" size="sm" onClick={loadReconciliations} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : reconciliations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Scale className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No reconciliations yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create a reconciliation to match your bank statement against your books.</p>
              <Button size="sm" className="mt-4" onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Start Reconciliation
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {reconciliations.map((recon) => {
                const isExpanded = expandedId === recon.id
                const diff = parseFloat(String(recon.difference)) || 0
                const isBalanced = Math.abs(diff) < 0.01

                return (
                  <div key={recon.id} className="rounded-lg border overflow-hidden">
                    {/* Header Row */}
                    <div
                      className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleExpand(recon.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Landmark className="h-4 w-4 text-blue-600 shrink-0" />
                          <span className="font-medium text-sm truncate">{recon.bank_account_label}</span>
                          <Badge className={`text-xs ${statusColor(recon.status)}`}>{recon.status.replace('_', ' ')}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(recon.period_start)} → {formatDate(recon.period_end)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="grid grid-cols-3 gap-4 text-xs">
                          <div>
                            <div className="text-muted-foreground mb-0.5">Statement</div>
                            <div className="font-mono font-medium">{formatCurrency(parseFloat(String(recon.statement_balance)) || 0)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-0.5">Book</div>
                            <div className="font-mono font-medium">{formatCurrency(parseFloat(String(recon.book_balance)) || 0)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-0.5">Difference</div>
                            <div className={`font-mono font-bold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(diff)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="border-t bg-muted/10 p-4 space-y-4">
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Created: {formatDate(recon.created_at)}</span>
                          {recon.reconciled_at && <span className="text-muted-foreground">Reconciled: {formatDate(recon.reconciled_at)}</span>}
                          {recon.notes && <span className="text-muted-foreground italic">{recon.notes}</span>}
                        </div>

                        {/* Reconciliation Status */}
                        <div className="flex items-center gap-3 p-3 rounded-lg border bg-background">
                          {isBalanced ? (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                              <div>
                                <p className="text-sm font-medium text-green-700">Balanced</p>
                                <p className="text-xs text-muted-foreground">Statement and book balances match.</p>
                              </div>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-5 w-5 text-amber-600" />
                              <div>
                                <p className="text-sm font-medium text-amber-700">Unreconciled Difference: {formatCurrency(diff)}</p>
                                <p className="text-xs text-muted-foreground">Add reconciliation lines to identify the discrepancy.</p>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Add Line Form */}
                        {showAddLine && expandedId === recon.id && (
                          <div className="p-3 rounded-lg border bg-background space-y-3">
                            <p className="text-sm font-medium">Add Reconciliation Line</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Date *</Label>
                                <Input type="date" value={lineForm.transaction_date} onChange={(e) => setLineForm({ ...lineForm, transaction_date: e.target.value })} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1 col-span-2">
                                <Label className="text-xs">Description *</Label>
                                <Input value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} className="h-8 text-sm" placeholder="e.g. Bank charge" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Reference</Label>
                                <Input value={lineForm.reference} onChange={(e) => setLineForm({ ...lineForm, reference: e.target.value })} className="h-8 text-sm" placeholder="Ref #" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Debit</Label>
                                <Input type="number" step="0.01" value={lineForm.debit_amount} onChange={(e) => setLineForm({ ...lineForm, debit_amount: e.target.value })} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Credit</Label>
                                <Input type="number" step="0.01" value={lineForm.credit_amount} onChange={(e) => setLineForm({ ...lineForm, credit_amount: e.target.value })} className="h-8 text-sm" />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={lineForm.source}
                                onChange={(e) => setLineForm({ ...lineForm, source: e.target.value })}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              >
                                <option value="statement">Statement Entry</option>
                                <option value="book">Book Entry</option>
                              </select>
                              <Button size="sm" className="h-8" onClick={() => handleAddLine(recon.id)} disabled={saving}>
                                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                                Add
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowAddLine(false)}>Cancel</Button>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        {recon.status !== 'completed' && recon.status !== 'void' && (
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
                              <Plus className="h-4 w-4 mr-1.5" />
                              Add Line
                            </Button>
                            {isBalanced && (
                              <Button size="sm" onClick={() => handleComplete(recon.id)}>
                                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                                Complete
                              </Button>
                            )}
                            <Button size="sm" variant="destructive" className="ml-auto" onClick={() => handleVoid(recon.id)}>
                              <XCircle className="h-4 w-4 mr-1.5" />
                              Void
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
