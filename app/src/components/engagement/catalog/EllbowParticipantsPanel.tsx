'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Search, UserPlus, Building2, RefreshCcw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'

type ParticipantMode = 'organizations' | 'users'
type SearchRow = Record<string, any>

export function EllbowParticipantsPanel() {
  const [mode, setMode] = useState<ParticipantMode>('organizations')
  return (
    <Tabs value={mode} onValueChange={(value) => setMode(value as ParticipantMode)} className="space-y-4">
      <TabsList>
        <TabsTrigger value="organizations"><Building2 className="mr-2 h-4 w-4" />Shops / Organizations</TabsTrigger>
        <TabsTrigger value="users"><UserPlus className="mr-2 h-4 w-4" />Users</TabsTrigger>
      </TabsList>
      <TabsContent value="organizations"><OrganizationParticipants /></TabsContent>
      <TabsContent value="users"><UserParticipants /></TabsContent>
    </Tabs>
  )
}

function OrganizationParticipants() {
  const { toast } = useToast()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [orgType, setOrgType] = useState('all')
  const [source, setSource] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [pending, setPending] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status !== 'all') params.set('status', status)
      if (orgType !== 'all') params.set('org_type', orgType)
      if (source !== 'all') params.set('source', source)
      const response = await fetch(`/api/engagement/catalog/ellbow/participants/organizations?${params}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setRows(body.organizations ?? [])
    } catch (error) {
      toast({ title: 'Unable to load Ellbow organizations', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [orgType, search, source, status, toast])

  useEffect(() => { load() }, [load])

  const updateStatus = async (row: any, nextStatus: 'active' | 'inactive', reason?: string) => {
    const response = await fetch('/api/engagement/catalog/ellbow/participants/organizations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_organization_id: row.member_organization_id, status: nextStatus, reason }),
    })
    const body = await response.json()
    if (!response.ok) return toast({ title: 'Membership update failed', description: body.error, variant: 'destructive' })
    toast({ title: nextStatus === 'active' ? 'Ellbow organization activated' : 'Ellbow organization deactivated' })
    setPending(null)
    load()
  }

  const totals = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.status === 'active').length,
    users: rows.reduce((sum, row) => sum + Number(row.active_users ?? 0), 0),
  }), [rows])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Ellbow Organization Participants</CardTitle>
            <CardDescription>Manage loyalty membership without changing organization master records.</CardDescription>
          </div>
          <Button onClick={() => setAddOpen(true)}><Building2 className="mr-2 h-4 w-4" />Add existing organization</Button>
        </div>
        <div className="grid gap-2 pt-3 md:grid-cols-4">
          <Input placeholder="Search organization, city, state" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Filter value={orgType} onChange={setOrgType} values={['all', 'SHOP', 'DIST', 'MFG', 'WH']} />
          <Filter value={status} onChange={setStatus} values={['all', 'active', 'inactive', 'ended', 'deleted']} />
          <Filter value={source} onChange={setSource} values={['all', 'admin', 'roadtour', 'legacy_backfill', 'legacy_registration']} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{totals.total} total</Badge>
          <Badge variant="outline">{totals.active} active</Badge>
          <Badge variant="outline">{totals.users} active users</Badge>
        </div>
        <ParticipantTable loading={loading} empty="No Ellbow organization memberships found.">
          {rows.map((row) => (
            <tr key={row.membership_id} className="border-b">
              <td className="p-3 font-medium">{row.org_name}</td>
              <td>{row.org_type_code}</td>
              <td>{[row.city, row.state_name].filter(Boolean).join(', ') || 'Not updated'}</td>
              <td><Badge variant="outline">Ellbow</Badge></td>
              <td><StatusBadge status={row.status} /></td>
              <td>{row.enrollment_source}</td>
              <td>{formatDate(row.enrolled_at)}</td>
              <td>{Number(row.active_users ?? 0).toLocaleString()}</td>
              <td>{row.last_audit_at ? formatDate(row.last_audit_at) : 'None'}</td>
              <td className="space-x-1">
                {row.status === 'active'
                  ? <Button size="sm" variant="outline" onClick={() => setPending({ row, type: 'organization' })}>Deactivate</Button>
                  : <Button size="sm" onClick={() => updateStatus(row, 'active')}>Activate</Button>}
              </td>
            </tr>
          ))}
        </ParticipantTable>
      </CardContent>
      <AddParticipantDialog mode="organizations" open={addOpen} onOpenChange={setAddOpen} onSaved={load} />
      <DeactivateDialog pending={pending} onCancel={() => setPending(null)} onConfirm={(reason) => updateStatus(pending.row, 'inactive', reason)} />
    </Card>
  )
}

function UserParticipants() {
  const { toast } = useToast()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [participantType, setParticipantType] = useState('all')
  const [source, setSource] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [pending, setPending] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status !== 'all') params.set('status', status)
      if (participantType !== 'all') params.set('participant_type', participantType)
      if (source !== 'all') params.set('source', source)
      const response = await fetch(`/api/engagement/catalog/ellbow/participants/users?${params}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setRows(body.users ?? [])
    } catch (error) {
      toast({ title: 'Unable to load Ellbow users', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [participantType, search, source, status, toast])

  useEffect(() => { load() }, [load])

  const updateUser = async (row: any, patch: Record<string, unknown>) => {
    const response = await fetch('/api/engagement/catalog/ellbow/participants/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        membership_id: row.membership_id,
        user_id: row.user_id,
        participant_type: patch.participant_type ?? row.participant_type,
        member_organization_id: patch.member_organization_id ?? row.member_organization_id,
        status: patch.status ?? row.status,
        reason: patch.reason,
      }),
    })
    const body = await response.json()
    if (!response.ok) return toast({ title: 'Membership update failed', description: body.error, variant: 'destructive' })
    toast({ title: 'Ellbow user membership updated' })
    setPending(null)
    load()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Ellbow User Participants</CardTitle>
            <CardDescription>Participant type controls loyalty behavior only. System roles are not changed.</CardDescription>
          </div>
          <Button onClick={() => setAddOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Add existing user</Button>
        </div>
        <div className="grid gap-2 pt-3 md:grid-cols-4">
          <Input placeholder="Search user, phone, email, organization" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Filter value={participantType} onChange={setParticipantType} values={['all', 'shop_staff', 'consumer', 'organization_user']} />
          <Filter value={status} onChange={setStatus} values={['all', 'active', 'inactive', 'ended', 'deleted']} />
          <Filter value={source} onChange={setSource} values={['all', 'admin', 'roadtour', 'legacy_backfill', 'legacy_registration']} />
        </div>
      </CardHeader>
      <CardContent>
        <ParticipantTable loading={loading} empty="No Ellbow user memberships found.">
          {rows.map((row) => (
            <tr key={row.membership_id} className="border-b">
              <td className="p-3 font-medium"><div>{row.full_name || 'Unnamed user'}</div><div className="text-xs text-muted-foreground">{row.email || row.phone || 'No contact'}</div></td>
              <td>{row.org_name || 'Independent'}</td>
              <td>
                <Select value={row.participant_type} onValueChange={(value) => updateUser(row, { participant_type: value })}>
                  <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shop_staff">shop staff</SelectItem>
                    <SelectItem value="consumer">consumer</SelectItem>
                    <SelectItem value="organization_user">organization user</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td><Badge variant="outline">Ellbow</Badge></td>
              <td><StatusBadge status={row.status} /></td>
              <td>{row.enrollment_source}</td>
              <td>{formatDate(row.enrolled_at)}</td>
              <td>{Number(row.wallet_balance ?? 0).toLocaleString()}</td>
              <td>{row.last_activity_at ? formatDate(row.last_activity_at) : 'None'}</td>
              <td className="space-x-1">
                {row.status === 'active'
                  ? <Button size="sm" variant="outline" onClick={() => setPending({ row, type: 'user' })}>Deactivate</Button>
                  : <Button size="sm" onClick={() => updateUser(row, { status: 'active' })}>Activate</Button>}
              </td>
            </tr>
          ))}
        </ParticipantTable>
      </CardContent>
      <AddParticipantDialog mode="users" open={addOpen} onOpenChange={setAddOpen} onSaved={load} />
      <DeactivateDialog pending={pending} onCancel={() => setPending(null)} onConfirm={(reason) => updateUser(pending.row, { status: 'inactive', reason })} />
    </Card>
  )
}

function AddParticipantDialog({ mode, open, onOpenChange, onSaved }: { mode: ParticipantMode; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchRow[]>([])
  const [selected, setSelected] = useState<SearchRow | null>(null)
  const [participantType, setParticipantType] = useState('shop_staff')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || query.trim().length < 2) { setRows([]); return }
    const controller = new AbortController()
    fetch(`/api/engagement/catalog/ellbow/participants/search?target=${mode}&search=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setRows(body.rows ?? [])
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setRows([])
      })
    return () => controller.abort()
  }, [mode, open, query])

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const endpoint = mode === 'organizations'
        ? '/api/engagement/catalog/ellbow/participants/organizations'
        : '/api/engagement/catalog/ellbow/participants/users'
      const payload = mode === 'organizations'
        ? { member_organization_id: selected.id, status: 'active' }
        : { user_id: selected.id, participant_type: participantType, member_organization_id: selected.organization_id ?? null, status: 'active' }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      toast({ title: mode === 'organizations' ? 'Organization added to Ellbow' : 'User added to Ellbow' })
      setSelected(null); setQuery(''); setRows([]); onOpenChange(false); onSaved()
    } catch (error) {
      toast({ title: 'Unable to add participant', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === 'organizations' ? 'Add existing organization' : 'Add existing user'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null) }} placeholder={mode === 'organizations' ? 'Organization name, code, city' : 'Name, email, phone'} />
            </div>
          </div>
          {mode === 'users' && <div className="space-y-2"><Label>Participant type</Label><Filter value={participantType} onChange={setParticipantType} values={['shop_staff', 'consumer', 'organization_user']} /></div>}
          <div className="max-h-64 overflow-y-auto rounded border">
            {rows.length === 0 ? <div className="p-4 text-sm text-muted-foreground">Type at least 2 characters to search existing records.</div> : rows.map((row) => (
              <button key={row.id} type="button" className={`block w-full border-b p-3 text-left text-sm hover:bg-muted ${selected?.id === row.id ? 'bg-muted' : ''}`} onClick={() => setSelected(row)}>
                <div className="font-medium">{row.org_name || row.full_name || 'Unnamed'}</div>
                <div className="text-xs text-muted-foreground">{row.org_type_code || row.email || row.phone || row.organizations?.org_name || 'Existing record'}</div>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={!selected || saving}>Add to Ellbow</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ParticipantTable({ loading, empty, children }: { loading: boolean; empty: string; children: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return loading ? <div className="py-12 text-center text-muted-foreground">Loading participants...</div> : !hasRows ? <div className="py-12 text-center text-muted-foreground">{empty}</div> : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-3">Participant</th><th>Type / organization</th><th>Location / type</th><th>Program</th><th>Status</th><th>Source</th><th>Enrolled</th><th>Users / balance</th><th>Last activity</th><th>Actions</th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function DeactivateDialog({ pending, onCancel, onConfirm }: { pending: any; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (!pending) setReason('') }, [pending])
  return (
    <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate Ellbow membership?</AlertDialogTitle>
          <AlertDialogDescription>New Ellbow earning and redemption will stop. Existing wallets, transactions, redemptions, users, and organizations remain unchanged.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label>Reason or admin note</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional audit note" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(reason)}>Deactivate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Filter({ value, onChange, values }: { value: string; onChange: (value: string) => void; values: string[] }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{values.map((item) => <SelectItem key={item} value={item}>{item.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select>
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'active' ? 'default' : 'outline'}>{status}</Badge>
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : 'None'
}
