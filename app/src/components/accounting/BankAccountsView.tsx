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
  Building2, RefreshCw, Loader2, Plus, Pencil, Trash2, Star,
  Landmark, Wallet, TrendingUp, CheckCircle2, XCircle, Save,
  X, CreditCard, DollarSign, Link2,
} from 'lucide-react'

interface BankAccountsViewProps {
  userProfile: { id: string; organizations: { id: string }; roles: { role_level: number } }
}

interface BankAccount {
  id: string
  account_name: string
  bank_name: string
  account_number: string
  bank_code: string | null
  branch: string | null
  currency_code: string
  gl_account_id: string | null
  opening_balance: number
  current_balance: number
  is_active: boolean
  is_default: boolean
  notes: string | null
  created_at: string
  gl_account: { code: string; name: string } | null
}

interface GLAccount {
  id: string
  code: string
  name: string
  account_type: string
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(amount)
}

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' })
}

const emptyForm = {
  account_name: '',
  bank_name: '',
  account_number: '',
  bank_code: '',
  branch: '',
  currency_code: 'MYR',
  gl_account_id: '',
  opening_balance: '0',
  is_default: false,
  notes: '',
}

export default function BankAccountsView({ userProfile }: BankAccountsViewProps) {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [availableGL, setAvailableGL] = useState<GLAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/accounting/cash/bank-accounts')
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
        setAvailableGL(data.availableGLAccounts || [])
      } else {
        toast({ title: 'Error', description: 'Failed to load bank accounts', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load bank accounts', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const handleEdit = (acct: BankAccount) => {
    setEditingId(acct.id)
    setForm({
      account_name: acct.account_name,
      bank_name: acct.bank_name,
      account_number: acct.account_number,
      bank_code: acct.bank_code || '',
      branch: acct.branch || '',
      currency_code: acct.currency_code,
      gl_account_id: acct.gl_account_id || '',
      opening_balance: String(acct.opening_balance || 0),
      is_default: acct.is_default,
      notes: acct.notes || '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.account_name || !form.bank_name || !form.account_number) {
      toast({ title: 'Validation Error', description: 'Account name, bank name, and account number are required', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        account_name: form.account_name,
        bank_name: form.bank_name,
        account_number: form.account_number,
        bank_code: form.bank_code || null,
        branch: form.branch || null,
        currency_code: form.currency_code || 'MYR',
        gl_account_id: form.gl_account_id || null,
        opening_balance: parseFloat(form.opening_balance) || 0,
        is_default: form.is_default,
        notes: form.notes || null,
      }

      let res: Response
      if (editingId) {
        res = await fetch('/api/accounting/cash/bank-accounts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload }),
        })
      } else {
        res = await fetch('/api/accounting/cash/bank-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      if (res.ok) {
        toast({ title: 'Success', description: editingId ? 'Bank account updated' : 'Bank account created' })
        setShowForm(false)
        setEditingId(null)
        setForm(emptyForm)
        loadAccounts()
      } else {
        const err = await res.json()
        toast({ title: 'Error', description: err.error || 'Failed to save', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save bank account', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (acct: BankAccount) => {
    try {
      const res = await fetch('/api/accounting/cash/bank-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: acct.id, is_active: !acct.is_active }),
      })
      if (res.ok) {
        toast({ title: 'Success', description: `Account ${!acct.is_active ? 'activated' : 'deactivated'}` })
        loadAccounts()
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update', variant: 'destructive' })
    }
  }

  const totalBalance = accounts.reduce((s, a) => s + (parseFloat(String(a.current_balance)) || 0), 0)
  const activeCount = accounts.filter(a => a.is_active).length
  const linkedCount = accounts.filter(a => a.gl_account_id).length
  const defaultAccount = accounts.find(a => a.is_default)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-medium text-muted-foreground">Bank Accounts</span>
            </div>
            <p className="text-2xl font-bold">{accounts.length}</p>
            <p className="text-xs text-muted-foreground">{activeCount} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-medium text-muted-foreground">Total Balance</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(totalBalance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Link2 className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-medium text-muted-foreground">GL Linked</span>
            </div>
            <p className="text-2xl font-bold text-purple-700">{linkedCount}</p>
            <p className="text-xs text-muted-foreground">of {accounts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Star className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-medium text-muted-foreground">Default Account</span>
            </div>
            <p className="text-sm font-bold truncate">{defaultAccount?.bank_name || 'Not Set'}</p>
            <p className="text-xs text-muted-foreground truncate">{defaultAccount?.account_name || '-'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              {editingId ? <Pencil className="h-5 w-5 text-blue-600" /> : <Plus className="h-5 w-5 text-blue-600" />}
              {editingId ? 'Edit Bank Account' : 'Add Bank Account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Account Name *</Label>
                <Input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} placeholder="e.g. Operating Account" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Bank Name *</Label>
                <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="e.g. Maybank" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Account Number *</Label>
                <Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder="e.g. 5123456789" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Bank Code</Label>
                <Input value={form.bank_code} onChange={(e) => setForm({ ...form, bank_code: e.target.value })} placeholder="e.g. MBBEMYKL" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Branch</Label>
                <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="e.g. KL Main" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Currency</Label>
                <Input value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} placeholder="MYR" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Linked GL Account</Label>
                <select
                  value={form.gl_account_id}
                  onChange={(e) => setForm({ ...form, gl_account_id: e.target.value })}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— No GL Link —</option>
                  {availableGL.map((gl) => (
                    <option key={gl.id} value={gl.id}>{gl.code} – {gl.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Opening Balance</Label>
                <Input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} className="h-9" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" className="h-9" />
              </div>
              <div className="space-y-1.5 flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="rounded" />
                  <span className="text-sm">Set as default account</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                {editingId ? 'Update' : 'Create'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }}>
                <X className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-blue-600" />
                Bank Accounts
              </CardTitle>
              <CardDescription>
                Manage bank accounts linked to your Chart of Accounts for cash tracking and reconciliation.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Account
              </Button>
              <Button variant="outline" size="sm" onClick={loadAccounts} disabled={loading}>
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
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Landmark className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No bank accounts yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first bank account to start tracking cash movements.</p>
              <Button size="sm" className="mt-4" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Bank Account
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead></TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Account #</TableHead>
                    <TableHead>GL Account</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Current Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acct) => (
                    <TableRow key={acct.id} className={!acct.is_active ? 'opacity-50' : ''}>
                      <TableCell className="w-8 text-center">
                        {acct.is_default && <Star className="h-4 w-4 text-amber-500 fill-amber-500 inline" />}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{acct.account_name}</TableCell>
                      <TableCell className="text-sm">
                        <div>{acct.bank_name}</div>
                        {acct.branch && <div className="text-xs text-muted-foreground">{acct.branch}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{acct.account_number}</TableCell>
                      <TableCell className="text-sm">
                        {acct.gl_account ? (
                          <span className="font-mono text-xs">
                            {acct.gl_account.code} <span className="text-muted-foreground">– {acct.gl_account.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(parseFloat(String(acct.opening_balance)) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {formatCurrency(parseFloat(String(acct.current_balance)) || 0)}
                      </TableCell>
                      <TableCell>
                        {acct.is_active ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500 border-gray-200 text-xs">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(acct)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleToggleActive(acct)}
                            title={acct.is_active ? 'Deactivate' : 'Activate'}>
                            {acct.is_active ? <XCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
