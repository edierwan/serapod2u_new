'use client'

/**
 * Scan Issues tab — track failed QR scans and drive WhatsApp follow-up.
 *
 * Layout mirrors the UI/UX draft (Image 6 from 2026-05-13 brief):
 *  - Header (title, subtitle, action buttons)
 *  - 4 KPI cards
 *  - Filter row + table + pagination
 *  - Right-side issue detail drawer
 *  - Bottom row: Admin WhatsApp Notification settings + Message Templates editor
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  Flame,
  RefreshCw,
  Download,
  MessageCircle,
  Send,
  Eye,
  X,
} from 'lucide-react'

type Issue = {
  id: string
  issue_no: string
  qr_code_text: string
  qr_code_id: string | null
  order_id: string | null
  product_name_snapshot: string | null
  shop_name_snapshot: string | null
  consumer_name_snapshot: string | null
  consumer_phone_snapshot: string | null
  consumer_email_snapshot: string | null
  consumer_whatsapp_number: string | null
  order_no_snapshot: string | null
  display_doc_no_snapshot: string | null
  issue_type: string
  error_code: string | null
  error_message: string
  user_facing_message: string | null
  status: 'pending' | 'in_progress' | 'resolved' | 'ignored'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  scan_attempted_at: string
  scan_date: string
  consumer_notification_status: string
  consumer_notification_sent_at: string | null
  admin_notification_status: string
  admin_notification_sent_at: string | null
  rescan_notification_status: string
  rescan_notification_sent_at: string | null
  resolution_note: string | null
  attempt_count: number
}

type Kpis = {
  total_issues: number
  pending: number
  resolved_today: number
  high_priority: number
}

type Template = {
  id: string
  template_key: string
  template_name: string
  recipient_type: 'consumer' | 'admin'
  body: string
  is_active: boolean
  org_id: string | null
}

const ISSUE_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  not_shipped_yet: { label: 'Not Shipped Yet', className: 'bg-red-100 text-red-700' },
  buffer_unpromoted: { label: 'Buffer (Unpromoted)', className: 'bg-red-100 text-red-700' },
  qr_not_found: { label: 'Invalid QR Code', className: 'bg-amber-100 text-amber-700' },
  already_collected: { label: 'Already Collected', className: 'bg-blue-100 text-blue-700' },
  expired_qr: { label: 'Expired Code', className: 'bg-amber-100 text-amber-700' },
  blocked_qr: { label: 'Blocked Code', className: 'bg-gray-200 text-gray-700' },
  qr_not_active: { label: 'Not Active', className: 'bg-amber-100 text-amber-700' },
  invalid_status: { label: 'Invalid Status', className: 'bg-amber-100 text-amber-700' },
  authentication_failed: { label: 'Auth Failed', className: 'bg-red-100 text-red-700' },
  system_error: { label: 'System Error', className: 'bg-red-100 text-red-700' },
  unknown_error: { label: 'Unknown', className: 'bg-gray-200 text-gray-700' },
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  ignored: 'bg-gray-100 text-gray-500',
}

const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
  urgent: 'bg-red-200 text-red-800',
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return '-'
  return new Date(s).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
}

function maskPhone(p: string | null | undefined) {
  if (!p) return '-'
  return p
}

export default function ScanIssuesTab() {
  const { toast } = useToast()

  // ---------- list state ----------
  const [issues, setIssues] = useState<Issue[]>([])
  const [kpis, setKpis] = useState<Kpis>({ total_issues: 0, pending: 0, resolved_today: 0, high_priority: 0 })
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)
  const [selected, setSelected] = useState<Issue | null>(null)

  // ---------- settings ----------
  const [settings, setSettings] = useState<any>(null)
  const [adminNumbersInput, setAdminNumbersInput] = useState('')

  // ---------- templates ----------
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editingBody, setEditingBody] = useState('')

  // ---------- load list ----------
  const loadIssues = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      })
      if (filterStatus !== 'all') params.set('status', filterStatus)
      if (filterType !== 'all') params.set('issue_type', filterType)
      if (filterPriority !== 'all') params.set('priority', filterPriority)
      if (q) params.set('q', q)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/scan-issues?${params.toString()}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setIssues(json.rows || [])
      setTotalCount(json.total_count || 0)
      setKpis(json.kpis || { total_issues: 0, pending: 0, resolved_today: 0, high_priority: 0 })
    } catch (err: any) {
      toast({ title: 'Failed to load scan issues', description: err?.message || 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/scan-issues/settings')
      if (!res.ok) return
      const json = await res.json()
      setSettings(json.settings)
      const nums = Array.isArray(json.settings?.admin_whatsapp_numbers) ? json.settings.admin_whatsapp_numbers : []
      setAdminNumbersInput(nums.join('\n'))
    } catch { /* ignore */ }
  }

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/scan-issues/templates')
      if (!res.ok) return
      const json = await res.json()
      setTemplates(json.templates || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { loadIssues(); /* eslint-disable-next-line */ }, [page, filterStatus, filterType, filterPriority])
  useEffect(() => { loadSettings(); loadTemplates() }, [])

  const onSearch = () => { setPage(1); loadIssues() }

  const updateIssue = async (id: string, body: any) => {
    const res = await fetch(`/api/scan-issues/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text()
      toast({ title: 'Update failed', description: t, variant: 'destructive' })
      return null
    }
    const j = await res.json()
    return j.issue as Issue
  }

  const sendNotification = async (id: string, templateKey: string, recipientType: 'consumer' | 'admin') => {
    const res = await fetch(`/api/scan-issues/${id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_key: templateKey, recipient_type: recipientType }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) {
      toast({ title: 'Send failed', description: json?.error || 'unknown', variant: 'destructive' })
      return
    }
    toast({ title: 'Sent', description: `WhatsApp ${templateKey} sent to ${recipientType}` })
    loadIssues()
  }

  const saveSettings = async () => {
    const nums = adminNumbersInput
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await fetch('/api/scan-issues/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_whatsapp_numbers: nums,
        notify_on_new_issue: settings?.notify_on_new_issue ?? true,
        notify_on_high_priority: settings?.notify_on_high_priority ?? true,
        notify_on_status_change: settings?.notify_on_status_change ?? false,
        notify_on_resolved: settings?.notify_on_resolved ?? false,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: 'Save failed', description: j?.error || 'unknown', variant: 'destructive' })
      return
    }
    setSettings(j.settings)
    if (j.invalid_numbers?.length) {
      toast({ title: 'Saved (some invalid)', description: `Skipped: ${j.invalid_numbers.join(', ')}`, variant: 'destructive' })
    } else {
      toast({ title: 'Settings saved' })
    }
  }

  const saveTemplate = async () => {
    if (!editingTemplate) return
    const res = await fetch(`/api/scan-issues/templates?id=${editingTemplate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editingBody, is_active: editingTemplate.is_active }),
    })
    if (!res.ok) {
      toast({ title: 'Template save failed', variant: 'destructive' })
      return
    }
    toast({ title: 'Template saved' })
    setEditingTemplate(null)
    loadTemplates()
  }

  const exportCsv = () => {
    if (!issues.length) return
    const header = ['issue_no', 'issue_type', 'status', 'priority', 'qr_code_text', 'order_no_snapshot', 'consumer_phone_snapshot', 'error_message', 'scan_attempted_at'].join(',')
    const rows = issues.map((r) => [
      r.issue_no,
      r.issue_type,
      r.status,
      r.priority,
      r.qr_code_text,
      r.order_no_snapshot || '',
      r.consumer_phone_snapshot || '',
      JSON.stringify(r.error_message),
      r.scan_attempted_at,
    ].join(','))
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scan-issues-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const ackTemplate = useMemo(() => templates.find((t) => t.template_key === 'issue_acknowledgement') || null, [templates])
  const rescanTemplate = useMemo(() => templates.find((t) => t.template_key === 'issue_resolved_rescan') || null, [templates])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-orange-600" />
          <div>
            <h2 className="text-2xl font-bold">Scan Issues</h2>
            <p className="text-sm text-gray-600">Track and manage QR scan issues reported by consumers</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            <MessageCircle className="h-4 w-4 mr-1" /> Message Templates
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!issues.length}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={loadIssues}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Issues" value={kpis.total_issues} icon={<AlertTriangle className="h-6 w-6 text-gray-500" />} />
        <KpiCard label="Pending" value={kpis.pending} icon={<Clock className="h-6 w-6 text-orange-500" />} valueClass="text-orange-600" />
        <KpiCard label="Resolved Today" value={kpis.resolved_today} icon={<CheckCircle2 className="h-6 w-6 text-green-500" />} valueClass="text-green-600" />
        <KpiCard label="High Priority" value={kpis.high_priority} icon={<Flame className="h-6 w-6 text-red-500" />} valueClass="text-red-600" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Input placeholder="Search QR / Order / Phone / Issue No" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearch()} />
            <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.entries(ISSUE_TYPE_BADGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={(v) => { setFilterPriority(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="All Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={onSearch}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Layout: table + side drawer */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <Card>
          <CardContent className="pt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Issue ID</Th>
                  <Th>Type</Th>
                  <Th>QR Code</Th>
                  <Th>Order No</Th>
                  <Th>Consumer Phone</Th>
                  <Th>Scan Time</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Last Notification</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={10} className="text-center py-6 text-gray-500">Loading...</td></tr>
                ) : issues.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-6 text-gray-500">No scan issues yet</td></tr>
                ) : issues.map((r) => {
                  const t = ISSUE_TYPE_BADGE[r.issue_type] || { label: r.issue_type, className: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <Td><button className="text-blue-600 hover:underline" onClick={() => setSelected(r)}>{r.issue_no}</button></Td>
                      <Td><Badge className={t.className}>{t.label}</Badge></Td>
                      <Td className="truncate max-w-[180px]" title={r.qr_code_text}>{r.qr_code_text}</Td>
                      <Td>{r.display_doc_no_snapshot || r.order_no_snapshot || '-'}</Td>
                      <Td>{maskPhone(r.consumer_phone_snapshot)}</Td>
                      <Td>{fmtDateTime(r.scan_attempted_at)}</Td>
                      <Td><Badge className={STATUS_BADGE[r.status] || ''}>{r.status}</Badge></Td>
                      <Td><Badge className={PRIORITY_BADGE[r.priority] || ''}>{r.priority}</Badge></Td>
                      <Td>{r.consumer_notification_status === 'sent' ? fmtDateTime(r.consumer_notification_sent_at) : r.consumer_notification_status}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm">
              <div>Showing {issues.length} of {totalCount}</div>
              <div className="flex gap-2 items-center">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
                <span>Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right drawer */}
        {selected && (
          <Card className="self-start">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                Issue Details
                <Badge className={STATUS_BADGE[selected.status] || ''}>{selected.status}</Badge>
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-blue-600 font-semibold">{selected.issue_no}</div>
                <div className="text-xs text-gray-500">Reported: {fmtDateTime(selected.scan_attempted_at)}</div>
              </div>
              <Section title="Consumer & Contact">
                <KV k="Phone (WhatsApp)" v={selected.consumer_whatsapp_number ? '+' + selected.consumer_whatsapp_number : (selected.consumer_phone_snapshot || '-')} />
                <KV k="Email" v={selected.consumer_email_snapshot || '-'} />
                <KV k="Name" v={selected.consumer_name_snapshot || '-'} />
              </Section>
              <Section title="QR & Order Details">
                <KV k="QR Code" v={<span className="break-all">{selected.qr_code_text}</span>} />
                <KV k="Order No" v={selected.display_doc_no_snapshot || selected.order_no_snapshot || '-'} />
                <KV k="Product" v={selected.product_name_snapshot || '-'} />
                <KV k="Shop" v={selected.shop_name_snapshot || '-'} />
              </Section>
              <Section title="Issue">
                <KV k="Type" v={selected.issue_type} />
                <KV k="Error" v={selected.error_message} />
                <KV k="Priority" v={selected.priority} />
                <KV k="Attempts" v={String(selected.attempt_count)} />
              </Section>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={async () => {
                  const updated = await updateIssue(selected.id, { status: 'in_progress' })
                  if (updated) { setSelected(updated); loadIssues() }
                }}>Mark In Progress</Button>
                <Button size="sm" onClick={async () => {
                  const updated = await updateIssue(selected.id, { status: 'resolved', mark_rectified: true })
                  if (updated) { setSelected(updated); loadIssues() }
                }}>Mark Resolved</Button>
              </div>

              <Section title="Send WhatsApp">
                <Button size="sm" className="w-full" onClick={() => sendNotification(selected.id, 'issue_acknowledgement', 'consumer')}>
                  <Send className="h-3 w-3 mr-1" /> Send Acknowledgement
                </Button>
                <Button size="sm" className="w-full" variant="outline" onClick={() => sendNotification(selected.id, 'issue_resolved_rescan', 'consumer')}>
                  <Send className="h-3 w-3 mr-1" /> Send Rescan Notification
                </Button>
                <Button size="sm" className="w-full" variant="ghost" onClick={() => sendNotification(selected.id, 'admin_new_issue_alert', 'admin')}>
                  <Send className="h-3 w-3 mr-1" /> Send Admin Alert
                </Button>
              </Section>

              <Section title="Notification History">
                <KV k="Consumer" v={`${selected.consumer_notification_status}${selected.consumer_notification_sent_at ? ' • ' + fmtDateTime(selected.consumer_notification_sent_at) : ''}`} />
                <KV k="Admin" v={`${selected.admin_notification_status}${selected.admin_notification_sent_at ? ' • ' + fmtDateTime(selected.admin_notification_sent_at) : ''}`} />
                <KV k="Rescan" v={`${selected.rescan_notification_status}${selected.rescan_notification_sent_at ? ' • ' + fmtDateTime(selected.rescan_notification_sent_at) : ''}`} />
              </Section>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Settings + Templates row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Admin WhatsApp Notifications */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Admin WhatsApp Notifications (System Alerts)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Admin WhatsApp Numbers (one per line)</label>
              <textarea
                value={adminNumbersInput}
                onChange={(e) => setAdminNumbersInput(e.target.value)}
                rows={3}
                className="w-full mt-1 border rounded p-2 text-sm font-mono"
                placeholder="60123456789&#10;60198765432"
              />
              <p className="text-[11px] text-gray-500 mt-1">Auto-normalized: removes +, spaces, dashes. 0xx → 60xx for Malaysia.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings?.notify_on_new_issue ?? true} onChange={(e) => setSettings({ ...(settings || {}), notify_on_new_issue: e.target.checked })} />
                New issue created
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings?.notify_on_high_priority ?? true} onChange={(e) => setSettings({ ...(settings || {}), notify_on_high_priority: e.target.checked })} />
                High priority only
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings?.notify_on_status_change ?? false} onChange={(e) => setSettings({ ...(settings || {}), notify_on_status_change: e.target.checked })} />
                Status updated
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings?.notify_on_resolved ?? false} onChange={(e) => setSettings({ ...(settings || {}), notify_on_resolved: e.target.checked })} />
                Issue resolved
              </label>
            </div>
            <Button size="sm" onClick={saveSettings}>Save Settings</Button>
          </CardContent>
        </Card>

        {/* Message Templates preview */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Message Templates</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>Manage</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[ackTemplate, rescanTemplate].filter(Boolean).map((tpl) => (
                <div key={tpl!.id} className="border rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium">{tpl!.template_name}</div>
                    <Badge className={tpl!.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>{tpl!.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <pre className="text-[11px] text-gray-600 whitespace-pre-wrap font-sans">{tpl!.body.slice(0, 220)}{tpl!.body.length > 220 ? '…' : ''}</pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Templates modal */}
      {templatesOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setTemplatesOpen(false); setEditingTemplate(null) }}>
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Message Templates</h3>
              <Button size="sm" variant="ghost" onClick={() => { setTemplatesOpen(false); setEditingTemplate(null) }}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                {templates.map((t) => (
                  <div key={t.id} className={`border rounded p-2 cursor-pointer ${editingTemplate?.id === t.id ? 'border-blue-400 bg-blue-50' : ''}`} onClick={() => { setEditingTemplate(t); setEditingBody(t.body) }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{t.template_name}</div>
                        <div className="text-[11px] text-gray-500">{t.template_key} · {t.recipient_type}</div>
                      </div>
                      <Badge className={t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                {editingTemplate ? (
                  <>
                    <div className="mb-2 text-sm font-medium">{editingTemplate.template_name}</div>
                    <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={12} className="w-full border rounded p-2 text-sm font-mono" />
                    <div className="text-[11px] text-gray-500 mt-1">Variables: <code>{'{{name}} {{consumer_phone}} {{qr_code}} {{order_no}} {{product_name}} {{issue_type}} {{error_message}} {{scan_time}} {{issue_no}} {{rescan_link}}'}</code></div>
                    <div className="mt-3 bg-green-50 border border-green-200 rounded p-3">
                      <div className="text-[10px] text-gray-500 mb-1">WhatsApp preview</div>
                      <pre className="text-xs whitespace-pre-wrap font-sans">{editingBody}</pre>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" onClick={saveTemplate}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">Select a template on the left to edit.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, icon, valueClass = '' }: { label: string; value: number; icon: React.ReactNode; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-600">{label}</div>
            <div className={`text-2xl font-bold ${valueClass}`}>{value.toLocaleString()}</div>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{children}</th>
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-3 py-2 text-xs text-gray-700 ${className}`} title={title}>{children}</td>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2 text-xs">
      <span className="text-gray-500 shrink-0">{k}</span>
      <span className="text-gray-800 text-right break-all">{v}</span>
    </div>
  )
}
