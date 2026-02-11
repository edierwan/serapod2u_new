'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ShieldCheck, FileText, Users } from 'lucide-react'

interface Policy {
    id: string
    title: string
    version: string
    is_active: boolean
}

interface Contract {
    id: string
    contract_type: string
    status: string
}

export default function HrComplianceDocsView() {
    const [policies, setPolicies] = useState<Policy[]>([])
    const [contracts, setContracts] = useState<Contract[]>([])
    const [loading, setLoading] = useState(true)
    const [policyDialogOpen, setPolicyDialogOpen] = useState(false)
    const [contractDialogOpen, setContractDialogOpen] = useState(false)
    const [policyForm, setPolicyForm] = useState({ title: '', version: '1.0', policy_url: '' })
    const [contractForm, setContractForm] = useState({ contract_type: '', contract_url: '' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [policiesRes, contractsRes] = await Promise.all([
            fetch('/api/hr/compliance/policies'),
            fetch('/api/hr/compliance/contracts')
        ])
        const policiesJson = await policiesRes.json()
        const contractsJson = await contractsRes.json()
        setPolicies(policiesJson.data || [])
        setContracts(contractsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreatePolicy = async () => {
        if (!policyForm.title.trim() || !policyForm.version.trim() || !policyForm.policy_url.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/compliance/policies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: policyForm.title.trim(),
                version: policyForm.version.trim(),
                policy_url: policyForm.policy_url.trim()
            })
        })
        setSaving(false)
        if (res.ok) {
            setPolicyDialogOpen(false)
            setPolicyForm({ title: '', version: '1.0', policy_url: '' })
            await load()
        }
    }

    const handleCreateContract = async () => {
        if (!contractForm.contract_type.trim() || !contractForm.contract_url.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/compliance/contracts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_type: contractForm.contract_type.trim(),
                contract_url: contractForm.contract_url.trim()
            })
        })
        setSaving(false)
        if (res.ok) {
            setContractDialogOpen(false)
            setContractForm({ contract_type: '', contract_url: '' })
            await load()
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg">Compliance & Documents</CardTitle>
                            <CardDescription>Policy management, contract storage, and audit-ready records.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setPolicyDialogOpen(true)}>New Policy</Button>
                            <Button onClick={() => setContractDialogOpen(true)}>Upload Contract</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Policies</p>
                            <p className="text-2xl font-semibold">{policies.length}</p>
                        </div>
                        <ShieldCheck className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Contracts</p>
                            <p className="text-2xl font-semibold">{contracts.length}</p>
                        </div>
                        <FileText className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Acknowledgements</p>
                            <p className="text-2xl font-semibold">{policies.filter(p => p.is_active).length}</p>
                        </div>
                        <Users className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Policies</CardTitle>
                    <CardDescription>Track versions and employee acknowledgements.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading policies...</div>
                    ) : policies.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No policies published.</div>
                    ) : (
                        <div className="space-y-3">
                            {policies.map(policy => (
                                <div key={policy.id} className="flex items-center justify-between rounded-lg border p-4">
                                    <div>
                                        <div className="font-medium">{policy.title}</div>
                                        <div className="text-sm text-muted-foreground">Version {policy.version}</div>
                                    </div>
                                    <Badge variant={policy.is_active ? 'default' : 'secondary'}>
                                        {policy.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Policy</DialogTitle>
                        <DialogDescription>Publish a policy document.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Title</label>
                            <Input
                                value={policyForm.title}
                                onChange={(e) => setPolicyForm(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="Employee Handbook"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Version</label>
                            <Input
                                value={policyForm.version}
                                onChange={(e) => setPolicyForm(prev => ({ ...prev, version: e.target.value }))}
                                placeholder="1.0"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Policy URL</label>
                            <Input
                                value={policyForm.policy_url}
                                onChange={(e) => setPolicyForm(prev => ({ ...prev, policy_url: e.target.value }))}
                                placeholder="https://..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPolicyDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreatePolicy} disabled={saving}>Publish</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={contractDialogOpen} onOpenChange={setContractDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Upload Contract</DialogTitle>
                        <DialogDescription>Add a contract document for an employee.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contract type</label>
                            <Input
                                value={contractForm.contract_type}
                                onChange={(e) => setContractForm(prev => ({ ...prev, contract_type: e.target.value }))}
                                placeholder="Employment Contract"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contract URL</label>
                            <Input
                                value={contractForm.contract_url}
                                onChange={(e) => setContractForm(prev => ({ ...prev, contract_url: e.target.value }))}
                                placeholder="https://..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setContractDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateContract} disabled={saving}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
