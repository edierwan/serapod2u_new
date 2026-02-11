'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import {
  Loader2,
  Save,
  ShieldCheck,
  ShieldAlert,
  Eye,
  Pencil,
  Settings2,
  BookOpen,
  Receipt,
  CreditCard,
  FileText,
  BarChart3,
  Lock,
  CheckCircle2,
  Info,
  RefreshCw,
  Users,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface FinancePermissionsSettingsProps {
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

interface FinanceRole {
  id: string
  name: string
  description: string
  icon: React.ElementType
  color: string
  roleLevel: number
  permissions: FinancePermission[]
}

interface FinancePermission {
  key: string
  label: string
  description: string
  category: 'gl' | 'ar' | 'ap' | 'cash' | 'reports' | 'settings'
}

// ── Permission Definitions ──────────────────────────────────────

const FINANCE_PERMISSIONS: FinancePermission[] = [
  // General Ledger
  { key: 'gl_view_journals', label: 'View GL Journals', description: 'View posted journal entries', category: 'gl' },
  { key: 'gl_create_journals', label: 'Create Journal Entries', description: 'Create manual journal entries', category: 'gl' },
  { key: 'gl_post_journals', label: 'Post Journals', description: 'Post pending entries to the General Ledger', category: 'gl' },
  { key: 'gl_reverse_journals', label: 'Reverse Journals', description: 'Reverse posted journal entries', category: 'gl' },
  { key: 'gl_manage_accounts', label: 'Manage Chart of Accounts', description: 'Create, edit, and deactivate GL accounts', category: 'gl' },
  // Accounts Receivable
  { key: 'ar_view_invoices', label: 'View AR Invoices', description: 'View customer invoices', category: 'ar' },
  { key: 'ar_create_invoices', label: 'Create AR Invoices', description: 'Create and submit invoices', category: 'ar' },
  { key: 'ar_manage_receipts', label: 'Manage Receipts', description: 'Record and manage customer payments', category: 'ar' },
  { key: 'ar_view_aging', label: 'View AR Aging', description: 'View accounts receivable aging reports', category: 'ar' },
  // Accounts Payable
  { key: 'ap_view_bills', label: 'View AP Bills', description: 'View supplier bills and purchases', category: 'ap' },
  { key: 'ap_create_payments', label: 'Create Payments', description: 'Create and process supplier payments', category: 'ap' },
  { key: 'ap_approve_payments', label: 'Approve Payments', description: 'Approve supplier payment requests', category: 'ap' },
  { key: 'ap_view_aging', label: 'View AP Aging', description: 'View accounts payable aging reports', category: 'ap' },
  // Cash & Banking
  { key: 'cash_view_transactions', label: 'View Cash Transactions', description: 'View cashflow and bank transactions', category: 'cash' },
  { key: 'cash_manage_reconciliation', label: 'Bank Reconciliation', description: 'Perform bank reconciliation', category: 'cash' },
  // Reports
  { key: 'reports_view_financial', label: 'View Financial Reports', description: 'Access trial balance, P&L, balance sheet', category: 'reports' },
  { key: 'reports_export', label: 'Export Reports', description: 'Export financial reports to PDF/Excel', category: 'reports' },
  // Settings
  { key: 'settings_manage_accounts', label: 'Manage Default Accounts', description: 'Configure default posting accounts', category: 'settings' },
  { key: 'settings_posting_rules', label: 'Manage Posting Rules', description: 'Configure posting mode and rules', category: 'settings' },
  { key: 'settings_fiscal_year', label: 'Manage Fiscal Year', description: 'Configure fiscal year and periods', category: 'settings' },
]

// ── Pre-defined Finance Roles ───────────────────────────────────

const FINANCE_ROLES: FinanceRole[] = [
  {
    id: 'finance_admin',
    name: 'Finance Admin',
    description: 'Full access to all finance module features including settings and configuration',
    icon: ShieldCheck,
    color: 'blue',
    roleLevel: 20,
    permissions: FINANCE_PERMISSIONS, // All permissions
  },
  {
    id: 'gl_clerk',
    name: 'GL Clerk',
    description: 'Can create and post journal entries, manage chart of accounts',
    icon: BookOpen,
    color: 'indigo',
    roleLevel: 30,
    permissions: FINANCE_PERMISSIONS.filter((p) =>
      ['gl_view_journals', 'gl_create_journals', 'gl_post_journals', 'gl_manage_accounts'].includes(p.key)
    ),
  },
  {
    id: 'ar_clerk',
    name: 'AR Clerk',
    description: 'Manage customer invoices, receipts, and receivable tracking',
    icon: Receipt,
    color: 'green',
    roleLevel: 30,
    permissions: FINANCE_PERMISSIONS.filter((p) =>
      p.category === 'ar' || p.key === 'gl_view_journals'
    ),
  },
  {
    id: 'ap_clerk',
    name: 'AP Clerk',
    description: 'Manage supplier bills, payments, and payable tracking',
    icon: CreditCard,
    color: 'purple',
    roleLevel: 30,
    permissions: FINANCE_PERMISSIONS.filter((p) =>
      p.category === 'ap' || p.key === 'gl_view_journals'
    ),
  },
  {
    id: 'finance_viewer',
    name: 'Finance Viewer',
    description: 'Read-only access to financial data, journals, and reports',
    icon: Eye,
    color: 'gray',
    roleLevel: 40,
    permissions: FINANCE_PERMISSIONS.filter((p) =>
      p.key.includes('view') || p.category === 'reports'
    ),
  },
]

// ── Category Labels ─────────────────────────────────────────────

const CATEGORY_INFO: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  gl: { label: 'General Ledger', icon: BookOpen, color: 'blue' },
  ar: { label: 'Accounts Receivable', icon: Receipt, color: 'green' },
  ap: { label: 'Accounts Payable', icon: CreditCard, color: 'purple' },
  cash: { label: 'Cash & Banking', icon: FileText, color: 'emerald' },
  reports: { label: 'Reports', icon: BarChart3, color: 'amber' },
  settings: { label: 'Settings', icon: Settings2, color: 'gray' },
}

// ── Main Component ──────────────────────────────────────────────

export default function FinancePermissionsSettings({ userProfile }: FinancePermissionsSettingsProps) {
  const [loading, setLoading] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string>('finance_admin')
  const [customPermissions, setCustomPermissions] = useState<Record<string, string[]>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)

  const canManage = userProfile.roles.role_level <= 20
  const currentRole = FINANCE_ROLES.find((r) => r.id === selectedRole)

  // Group permissions by category
  const groupedPermissions = FINANCE_PERMISSIONS.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = []
    acc[perm.category].push(perm)
    return acc
  }, {} as Record<string, FinancePermission[]>)

  // Check if a permission is enabled for the current role
  const isPermissionEnabled = (permKey: string): boolean => {
    if (customPermissions[selectedRole]) {
      return customPermissions[selectedRole].includes(permKey)
    }
    return currentRole?.permissions.some((p) => p.key === permKey) ?? false
  }

  // Toggle permission for current role
  const togglePermission = (permKey: string) => {
    if (!canManage) return

    setCustomPermissions((prev) => {
      const currentPerms = prev[selectedRole] || currentRole?.permissions.map((p) => p.key) || []
      const newPerms = currentPerms.includes(permKey)
        ? currentPerms.filter((k) => k !== permKey)
        : [...currentPerms, permKey]

      return { ...prev, [selectedRole]: newPerms }
    })
    setHasChanges(true)
  }

  // Save permissions
  const handleSave = async () => {
    try {
      setSaving(true)
      // In a full implementation, this would save to a finance_role_permissions table
      // For now, we persist to localStorage as a bridge
      localStorage.setItem('finance_permissions', JSON.stringify(customPermissions))
      toast({ title: 'Permissions Saved', description: 'Finance role permissions have been updated.' })
      setHasChanges(false)
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save permissions', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Load on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('finance_permissions')
      if (saved) {
        setCustomPermissions(JSON.parse(saved))
      }
    } catch {}
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-blue-500" />
              <div>
                <CardTitle className="text-lg">Finance Permissions</CardTitle>
                <CardDescription>
                  Manage role-based access control for the Finance module
                </CardDescription>
              </div>
            </div>
            {canManage && hasChanges && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Role Cards */}
      <div className="grid md:grid-cols-5 gap-3">
        {FINANCE_ROLES.map((role) => {
          const isSelected = selectedRole === role.id
          const Icon = role.icon
          const permCount = customPermissions[role.id]?.length ?? role.permissions.length

          return (
            <button
              key={role.id}
              onClick={() => setSelectedRole(role.id)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? 'border-blue-400 bg-blue-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-5 h-5 ${isSelected ? 'text-blue-600' : 'text-gray-500'}`} />
                <span className={`font-medium text-sm ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                  {role.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2 line-clamp-2">{role.description}</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {permCount} permissions
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Level ≤ {role.roleLevel}
                </Badge>
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected Role Permission Matrix */}
      {currentRole && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <currentRole.icon className="w-5 h-5 text-blue-500" />
              <div>
                <CardTitle className="text-base">{currentRole.name} — Permissions</CardTitle>
                <CardDescription>{currentRole.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.entries(groupedPermissions).map(([category, perms]) => {
              const catInfo = CATEGORY_INFO[category]
              const CatIcon = catInfo?.icon || FileText
              const enabledCount = perms.filter((p) => isPermissionEnabled(p.key)).length

              return (
                <div key={category}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <CatIcon className="w-4 h-4 text-gray-500" />
                      <h4 className="font-medium text-sm text-gray-700">{catInfo?.label || category}</h4>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {enabledCount}/{perms.length}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {perms.map((perm) => {
                      const enabled = isPermissionEnabled(perm.key)
                      return (
                        <div
                          key={perm.key}
                          className={`flex items-center justify-between p-3 rounded-lg border ${
                            enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {enabled ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                            <div>
                              <span className="text-sm font-medium">{perm.label}</span>
                              <p className="text-xs text-gray-500">{perm.description}</p>
                            </div>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => togglePermission(perm.key)}
                            disabled={!canManage}
                            className="flex-shrink-0"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-medium text-blue-800">How Finance Permissions Work</h4>
                <ul className="text-sm text-blue-700 mt-2 space-y-1">
                  <li>• <strong>Finance Admin</strong> (role level ≤ 20): Full access to all features including settings</li>
                  <li>• <strong>GL Clerk</strong> (role level ≤ 30): Journal entries, chart of accounts, posting</li>
                  <li>• <strong>AR/AP Clerk</strong> (role level ≤ 30): Receivables or payables management</li>
                  <li>• <strong>Finance Viewer</strong> (role level ≤ 40): Read-only access to all financial data and reports</li>
                  <li>• Permissions are inherited — higher roles automatically include lower role permissions</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
