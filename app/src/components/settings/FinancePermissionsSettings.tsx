'use client'

import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { permissionLabel } from '@/lib/security-access/labels'

interface FinancePermissionsSettingsProps {
  userProfile: unknown
}

/**
 * Finance access is administered in Security & Access. This screen used to
 * edit a role matrix stored only in the browser (localStorage) — it never
 * decided anything, but it looked authoritative. It now explains the Finance
 * business roles and links to where access is granted, reviewed and revoked.
 */
const FINANCE_ROLES: Array<{ name: string; description: string; permissions: string[] }> = [
  { name: 'Finance Admin', description: 'Full Finance administration including settings.', permissions: ['finance.module.view', 'finance.ledger.view', 'finance.report.view_sensitive', 'finance.receivable.view', 'finance.payable.view', 'finance.cash.view', 'finance.reconciliation.perform', 'finance.journal.post', 'finance.account.manage', 'finance.settings.manage', 'finance.payroll_integration.manage'] },
  { name: 'GL Clerk', description: 'Posts documents to the ledger and maintains the chart of accounts.', permissions: ['finance.module.view', 'finance.ledger.view', 'finance.journal.post', 'finance.account.manage'] },
  { name: 'AR Clerk', description: 'Receivables, receipts and receivable reporting.', permissions: ['finance.module.view', 'finance.ledger.view', 'finance.receivable.view'] },
  { name: 'AP Clerk', description: 'Payables and supplier payments (without approval).', permissions: ['finance.module.view', 'finance.ledger.view', 'finance.payable.view'] },
  { name: 'Finance Viewer', description: 'Read-only Finance access including sensitive reports.', permissions: ['finance.module.view', 'finance.ledger.view', 'finance.report.view_sensitive', 'finance.receivable.view', 'finance.payable.view', 'finance.cash.view'] },
  { name: 'Payment Approver', description: 'Approves supplier balance payment requests (maker/checker monitored).', permissions: ['finance.module.view', 'finance.payable.view', 'finance.payment.approve'] },
]

export default function FinancePermissionsSettings(_props: FinancePermissionsSettingsProps) {
  // Remove the retired browser-only matrix so it can never be mistaken for
  // configuration again.
  useEffect(() => {
    try { localStorage.removeItem('finance_permissions') } catch { /* storage unavailable */ }
  }, [])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-blue-500" />
              <div>
                <CardTitle className="text-lg">Finance Permissions</CardTitle>
                <CardDescription>
                  Finance access is decided on the server by Security &amp; Access. Grant, request, review and revoke Finance roles there.
                </CardDescription>
              </div>
            </div>
            <a href="/security-access" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">
              Open Security &amp; Access <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </CardHeader>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {FINANCE_ROLES.map(role => (
          <Card key={role.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{role.name}</CardTitle>
              <CardDescription>{role.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {role.permissions.map(key => <Badge key={key} variant="secondary" title={key}>{permissionLabel(key).label}</Badge>)}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
