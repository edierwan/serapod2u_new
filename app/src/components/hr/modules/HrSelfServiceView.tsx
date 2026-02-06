'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FileText, User, ClipboardList } from 'lucide-react'

interface ChangeRequest {
    id: string
    status: string
}

interface DocumentRequest {
    id: string
    document_type: string
    status: string
}

export default function HrSelfServiceView() {
    const [changes, setChanges] = useState<ChangeRequest[]>([])
    const [documents, setDocuments] = useState<DocumentRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [changeDialogOpen, setChangeDialogOpen] = useState(false)
    const [documentDialogOpen, setDocumentDialogOpen] = useState(false)
    const [changePayload, setChangePayload] = useState('')
    const [documentType, setDocumentType] = useState('Employment Letter')
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [changesRes, docsRes] = await Promise.all([
            fetch('/api/hr/self-service/profile-change-requests'),
            fetch('/api/hr/self-service/document-requests')
        ])
        const changesJson = await changesRes.json()
        const docsJson = await docsRes.json()
        setChanges(changesJson.data || [])
        setDocuments(docsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateChangeRequest = async () => {
        if (!changePayload.trim()) return
        setSaving(true)
        let payload: any = null
        try {
            payload = JSON.parse(changePayload)
        } catch (error) {
            setSaving(false)
            return
        }
        const res = await fetch('/api/hr/self-service/profile-change-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change_payload: payload })
        })
        setSaving(false)
        if (res.ok) {
            setChangeDialogOpen(false)
            setChangePayload('')
            await load()
        }
    }

    const handleCreateDocumentRequest = async () => {
        if (!documentType.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/self-service/document-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_type: documentType.trim() })
        })
        setSaving(false)
        if (res.ok) {
            setDocumentDialogOpen(false)
            setDocumentType('Employment Letter')
            await load()
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Employee Self-Service</CardTitle>
                            <CardDescription>Empower employees to manage profiles, requests, and documents.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setChangeDialogOpen(true)}>New Profile Request</Button>
                            <Button onClick={() => setDocumentDialogOpen(true)}>Request Document</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Profile Changes</p>
                            <p className="text-2xl font-semibold">{changes.length}</p>
                        </div>
                        <User className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Doc Requests</p>
                            <p className="text-2xl font-semibold">{documents.length}</p>
                        </div>
                        <FileText className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Approvals</p>
                            <p className="text-2xl font-semibold">{changes.filter(c => c.status === 'pending').length}</p>
                        </div>
                        <ClipboardList className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Document Requests</CardTitle>
                    <CardDescription>Track issuance status and SLAs.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading requests...</div>
                    ) : documents.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No document requests.</div>
                    ) : (
                        <div className="space-y-3">
                            {documents.slice(0, 6).map(doc => (
                                <div key={doc.id} className="flex items-center justify-between rounded-lg border p-4">
                                    <div>
                                        <div className="font-medium">{doc.document_type}</div>
                                        <div className="text-sm text-muted-foreground">Request ID {doc.id.slice(0, 6).toUpperCase()}</div>
                                    </div>
                                    <Badge variant={doc.status === 'pending' ? 'secondary' : 'default'}>
                                        {doc.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={changeDialogOpen} onOpenChange={setChangeDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Profile Change Request</DialogTitle>
                        <DialogDescription>Submit a JSON payload for profile updates.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Change payload (JSON)</label>
                        <Textarea
                            value={changePayload}
                            onChange={(e) => setChangePayload(e.target.value)}
                            placeholder='{"phone": "+60123456789"}'
                            rows={5}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setChangeDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateChangeRequest} disabled={saving}>Submit</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Document Request</DialogTitle>
                        <DialogDescription>Request a new HR document.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Document type</label>
                        <Input
                            value={documentType}
                            onChange={(e) => setDocumentType(e.target.value)}
                            placeholder="Employment Letter"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDocumentDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateDocumentRequest} disabled={saving}>Request</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
