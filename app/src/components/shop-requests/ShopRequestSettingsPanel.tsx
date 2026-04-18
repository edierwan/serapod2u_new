'use client'

import { useEffect, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { manualNumbersToTextarea, normalizeShopRequestNotificationSettings, textareaToManualNumbers, type ShopRequestNotificationSettings } from '@/lib/engagement/shop-request-settings'

interface ShopRequestSettingsPanelProps {
    onAlert: (type: 'success' | 'error' | 'info', message: string) => void
}

interface ShopRequestRow {
    id: string
    requester_name: string | null
    requester_phone: string | null
    requested_shop_name: string
    requested_branch: string | null
    requested_contact_name: string | null
    requested_contact_phone: string | null
    requested_contact_email: string | null
    requested_address: string | null
    requested_state: string | null
    requested_hot_flavour_brands: string | null
    requested_sells_serapod_flavour: boolean
    requested_sells_sbox: boolean
    requested_sells_sbox_special_edition: boolean
    requested_parent_org_id: string | null
    notes: string | null
    status: 'pending' | 'approved' | 'rejected'
    review_notes: string | null
    approved_organization_name: string | null
}

const defaultSettings = normalizeShopRequestNotificationSettings(null)

export function ShopRequestSettingsPanel({ onAlert }: ShopRequestSettingsPanelProps) {
    const [settings, setSettings] = useState<ShopRequestNotificationSettings>(defaultSettings)
    const [manualNumbers, setManualNumbers] = useState('')
    const [requests, setRequests] = useState<ShopRequestRow[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})

    const loadData = async () => {
        try {
            setLoading(true)
            const [settingsResponse, requestsResponse] = await Promise.all([
                fetch('/api/admin/shop-requests/settings'),
                fetch('/api/admin/shop-requests?status=all'),
            ])

            const settingsResult = await settingsResponse.json()
            const requestsResult = await requestsResponse.json()

            if (!settingsResponse.ok || !settingsResult.success) {
                throw new Error(settingsResult.error || 'Failed to load shop request settings.')
            }

            if (!requestsResponse.ok || !requestsResult.success) {
                throw new Error(requestsResult.error || 'Failed to load shop requests.')
            }

            const normalized = normalizeShopRequestNotificationSettings(settingsResult.settings)
            setSettings(normalized)
            setManualNumbers(manualNumbersToTextarea(normalized.manualNumbers))
            setRequests(requestsResult.requests || [])
        } catch (error: any) {
            onAlert('error', error.message || 'Failed to load shop request settings.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void loadData()
    }, [])

    const saveSettings = async () => {
        try {
            setSaving(true)
            const payload = {
                ...settings,
                manualNumbers: textareaToManualNumbers(manualNumbers),
            }

            const response = await fetch('/api/admin/shop-requests/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            const result = await response.json()
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to save shop request settings.')
            }

            setSettings(result.settings)
            setManualNumbers(manualNumbersToTextarea(result.settings.manualNumbers))
            onAlert('success', 'Shop request notification settings saved successfully.')
        } catch (error: any) {
            onAlert('error', error.message || 'Failed to save shop request settings.')
        } finally {
            setSaving(false)
        }
    }

    const reviewRequest = async (requestId: string, action: 'approve' | 'reject', row: ShopRequestRow) => {
        try {
            const response = await fetch(`/api/admin/shop-requests/${requestId}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shopName: row.requested_shop_name,
                    branch: row.requested_branch,
                    contactName: row.requested_contact_name,
                    contactPhone: row.requested_contact_phone,
                    contactEmail: row.requested_contact_email,
                    address: row.requested_address,
                    state: row.requested_state,
                    hotFlavourBrands: row.requested_hot_flavour_brands,
                    sellsSerapodFlavour: row.requested_sells_serapod_flavour,
                    sellsSbox: row.requested_sells_sbox,
                    sellsSboxSpecialEdition: row.requested_sells_sbox_special_edition,
                    parentOrgId: row.requested_parent_org_id,
                    reviewNotes: reviewNotes[requestId] || '',
                }),
            })

            const result = await response.json()
            if (!response.ok || !result.success) {
                throw new Error(result.error || `Failed to ${action} shop request.`)
            }

            onAlert('success', action === 'approve' ? 'Shop request approved.' : 'Shop request rejected.')
            await loadData()
        } catch (error: any) {
            onAlert('error', error.message || `Failed to ${action} shop request.`)
        }
    }

    if (loading) {
        return <div className="text-sm text-muted-foreground">Loading shop request settings...</div>
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Shop Request Notifications</CardTitle>
                    <CardDescription>Configure who receives WhatsApp notifications when users submit a pending new-shop request.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                            <Label className="font-medium">Enable Notifications</Label>
                            <p className="text-xs text-muted-foreground mt-1">Send pending-shop-request notifications to HQ/Admin recipients.</p>
                        </div>
                        <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, enabled: checked }))} />
                    </div>

                    <div className="space-y-2">
                        <Label>Recipient Mode</Label>
                        <Select value={settings.recipientMode} onValueChange={(value) => setSettings((current) => ({ ...current, recipientMode: value as 'manual' | 'hq_org' }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">Manual WhatsApp numbers</SelectItem>
                                <SelectItem value="hq_org">HQ/Admin users in organization</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Manual Numbers</Label>
                        <Textarea value={manualNumbers} onChange={(event) => setManualNumbers(event.target.value)} rows={4} placeholder="One phone number per line" />
                    </div>

                    <div className="space-y-2">
                        <Label>Admin Request Template</Label>
                        <Textarea value={settings.requestTemplate} onChange={(event) => setSettings((current) => ({ ...current, requestTemplate: event.target.value }))} rows={6} />
                    </div>

                    <div className="space-y-2">
                        <Label>Approval Template</Label>
                        <Textarea value={settings.approvalTemplate} onChange={(event) => setSettings((current) => ({ ...current, approvalTemplate: event.target.value }))} rows={4} />
                    </div>

                    <div className="space-y-2">
                        <Label>Rejection Template</Label>
                        <Textarea value={settings.rejectionTemplate} onChange={(event) => setSettings((current) => ({ ...current, rejectionTemplate: event.target.value }))} rows={4} />
                    </div>

                    <Button onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save Shop Request Settings'}</Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Pending Shop Requests</CardTitle>
                    <CardDescription>Review, approve, or reject user-submitted shop requests before any live shop organization is created.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {requests.length === 0 && (
                        <Alert>
                            <AlertDescription>No shop requests found.</AlertDescription>
                        </Alert>
                    )}

                    {requests.map((row) => (
                        <div key={row.id} className="rounded-lg border p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="font-medium">{row.requested_shop_name}{row.requested_branch ? ` (${row.requested_branch})` : ''}</p>
                                    <p className="text-sm text-muted-foreground">Requested by {row.requester_name || 'Unknown'} · {row.requester_phone || 'No phone'}</p>
                                </div>
                                <Badge variant={row.status === 'pending' ? 'secondary' : row.status === 'approved' ? 'default' : 'destructive'}>{row.status}</Badge>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <Input value={row.requested_contact_name || ''} readOnly placeholder="Contact name" />
                                <Input value={row.requested_contact_phone || ''} readOnly placeholder="Contact phone" />
                                <Input value={row.requested_contact_email || ''} readOnly placeholder="Contact email" />
                                <Input value={row.requested_state || ''} readOnly placeholder="State" />
                                <Input value={row.requested_address || ''} readOnly placeholder="Address" />
                                <Input value={row.requested_hot_flavour_brands || ''} readOnly placeholder="Hot flavour brands" />
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                                <Input value={row.requested_sells_serapod_flavour ? 'Ya' : 'Tidak'} readOnly placeholder="Sells Flavour Serapod" />
                                <Input value={row.requested_sells_sbox ? 'Ya' : 'Tidak'} readOnly placeholder="Sells S.Box" />
                                <Input value={row.requested_sells_sbox_special_edition ? 'Ya' : 'Tidak'} readOnly placeholder="Sells S.Box Special Edition" />
                            </div>

                            <Textarea value={reviewNotes[row.id] ?? row.review_notes ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} rows={2} placeholder="Review notes" />

                            {row.status === 'approved' && row.approved_organization_name && (
                                <p className="text-sm text-emerald-700">Created shop: {row.approved_organization_name}</p>
                            )}

                            {row.status === 'pending' && (
                                <div className="flex gap-3">
                                    <Button onClick={() => void reviewRequest(row.id, 'approve', row)}>Approve & Create Shop</Button>
                                    <Button variant="outline" onClick={() => void reviewRequest(row.id, 'reject', row)}>Reject</Button>
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}