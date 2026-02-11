'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Users, ShieldCheck } from 'lucide-react'

interface Provider {
    id: string
    name: string
    is_active: boolean
}

interface Plan {
    id: string
    name: string
    plan_type: string
    is_active: boolean
}

interface Enrollment {
    id: string
    status: string
}

interface ContributionRun {
    id: string
    period_start: string
    period_end: string
    status: string
    total_amount: number | null
    currency: string | null
}

export default function HrBenefitsView() {
    const [providers, setProviders] = useState<Provider[]>([])
    const [plans, setPlans] = useState<Plan[]>([])
    const [enrollments, setEnrollments] = useState<Enrollment[]>([])
    const [loading, setLoading] = useState(true)
    const [providerDialogOpen, setProviderDialogOpen] = useState(false)
    const [planDialogOpen, setPlanDialogOpen] = useState(false)
    const [glDialogOpen, setGlDialogOpen] = useState(false)
    const [postDialogOpen, setPostDialogOpen] = useState(false)
    const [providerForm, setProviderForm] = useState({ name: '', contact_email: '', contact_phone: '' })
    const [planForm, setPlanForm] = useState({ provider_id: 'none', name: '', plan_type: 'Medical' })
    const [glForm, setGlForm] = useState({ employer_contribution_account: '', employee_contribution_account: '' })
    const [postForm, setPostForm] = useState({ run_id: '', amount: '' })
    const [contributionRuns, setContributionRuns] = useState<ContributionRun[]>([])
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [providersRes, plansRes, enrollmentsRes, runsRes] = await Promise.all([
            fetch('/api/hr/benefits/providers'),
            fetch('/api/hr/benefits/plans'),
            fetch('/api/hr/benefits/enrollments'),
            fetch('/api/hr/benefits/contribution-runs')
        ])
        const providersJson = await providersRes.json()
        const plansJson = await plansRes.json()
        const enrollmentsJson = await enrollmentsRes.json()
        const runsJson = await runsRes.json()
        setProviders(providersJson.data || [])
        setPlans(plansJson.data || [])
        setEnrollments(enrollmentsJson.data || [])
        setContributionRuns(runsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateProvider = async () => {
        if (!providerForm.name.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/benefits/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: providerForm.name.trim(),
                contact_email: providerForm.contact_email.trim() || null,
                contact_phone: providerForm.contact_phone.trim() || null
            })
        })
        setSaving(false)
        if (res.ok) {
            setProviderDialogOpen(false)
            setProviderForm({ name: '', contact_email: '', contact_phone: '' })
            await load()
        }
    }

    const handleCreatePlan = async () => {
        if (!planForm.name.trim() || !planForm.plan_type.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/benefits/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider_id: planForm.provider_id === 'none' ? null : planForm.provider_id,
                name: planForm.name.trim(),
                plan_type: planForm.plan_type.trim()
            })
        })
        setSaving(false)
        if (res.ok) {
            setPlanDialogOpen(false)
            setPlanForm({ provider_id: 'none', name: '', plan_type: 'Medical' })
            await load()
        }
    }

    const handleSaveGlMapping = async () => {
        if (!glForm.employer_contribution_account.trim() || !glForm.employee_contribution_account.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/finance/gl-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                document_type: 'HR_BENEFIT_CONTRIBUTION',
                expense_account_id: glForm.employer_contribution_account.trim(),
                offset_account_id: glForm.employee_contribution_account.trim()
            })
        })
        setSaving(false)
        if (res.ok) {
            setGlDialogOpen(false)
        }
    }

    const handlePostContributionRun = async () => {
        if (!postForm.run_id.trim()) return
        setSaving(true)
        const amount = postForm.amount ? Number(postForm.amount) : null
        const res = await fetch('/api/hr/finance/post-benefit-contribution-run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                run_id: postForm.run_id.trim(),
                amount: Number.isFinite(amount) ? amount : null
            })
        })
        setSaving(false)
        if (res.ok) {
            setPostDialogOpen(false)
            setPostForm({ run_id: '', amount: '' })
            await load()
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg">Benefits Administration</CardTitle>
                            <CardDescription>Manage benefits enrollment, eligibility, and renewals.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setProviderDialogOpen(true)}>New Provider</Button>
                            <Button onClick={() => setPlanDialogOpen(true)}>Create Plan</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Providers</p>
                            <p className="text-2xl font-semibold">{providers.length}</p>
                        </div>
                        <ShieldCheck className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Plans</p>
                            <p className="text-2xl font-semibold">{plans.length}</p>
                        </div>
                        <FileText className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Enrollments</p>
                            <p className="text-2xl font-semibold">{enrollments.length}</p>
                        </div>
                        <Users className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Benefit Plans</CardTitle>
                    <CardDescription>Plans available to employees with contribution details.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading plans...</div>
                    ) : plans.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No plans available.</div>
                    ) : (
                        <div className="space-y-3">
                            {plans.map(plan => (
                                <div key={plan.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-medium">{plan.name}</div>
                                        <div className="text-sm text-muted-foreground">{plan.plan_type}</div>
                                    </div>
                                    <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                                        {plan.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Finance Integration</CardTitle>
                    <CardDescription>Map benefit contributions to GL accounts for payroll posting.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">Configure GL mappings for employer/employee contributions and accruals.</p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setGlDialogOpen(true)}>Configure GL Mapping</Button>
                        <Button onClick={() => setPostDialogOpen(true)}>Post Contribution Run</Button>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Benefit Provider</DialogTitle>
                        <DialogDescription>Register a benefits provider for your organization.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Provider name</label>
                            <Input
                                value={providerForm.name}
                                onChange={(e) => setProviderForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Medical insurer"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contact email</label>
                            <Input
                                value={providerForm.contact_email}
                                onChange={(e) => setProviderForm(prev => ({ ...prev, contact_email: e.target.value }))}
                                placeholder="support@provider.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contact phone</label>
                            <Input
                                value={providerForm.contact_phone}
                                onChange={(e) => setProviderForm(prev => ({ ...prev, contact_phone: e.target.value }))}
                                placeholder="+60 12 345 6789"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProviderDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateProvider} disabled={saving}>Save Provider</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Benefit Plan</DialogTitle>
                        <DialogDescription>Define plan type and provider.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Plan name</label>
                            <Input
                                value={planForm.name}
                                onChange={(e) => setPlanForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Premium Medical"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Plan type</label>
                            <Select value={planForm.plan_type} onValueChange={(value) => setPlanForm(prev => ({ ...prev, plan_type: value }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Medical">Medical</SelectItem>
                                    <SelectItem value="Dental">Dental</SelectItem>
                                    <SelectItem value="Vision">Vision</SelectItem>
                                    <SelectItem value="Life">Life</SelectItem>
                                    <SelectItem value="Wellness">Wellness</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Provider</label>
                            <Select value={planForm.provider_id} onValueChange={(value) => setPlanForm(prev => ({ ...prev, provider_id: value }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No provider</SelectItem>
                                    {providers.map(provider => (
                                        <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPlanDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreatePlan} disabled={saving}>Save Plan</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={glDialogOpen} onOpenChange={setGlDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>GL Mapping for Benefits</DialogTitle>
                        <DialogDescription>Map benefit contributions to GL accounts (company scoped).</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employer contribution account</label>
                            <Input
                                value={glForm.employer_contribution_account}
                                onChange={(e) => setGlForm(prev => ({ ...prev, employer_contribution_account: e.target.value }))}
                                placeholder="GL Account ID"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee contribution account</label>
                            <Input
                                value={glForm.employee_contribution_account}
                                onChange={(e) => setGlForm(prev => ({ ...prev, employee_contribution_account: e.target.value }))}
                                placeholder="GL Account ID"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGlDialogOpen(false)}>Close</Button>
                        <Button onClick={handleSaveGlMapping} disabled={saving}>Save Mapping</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={postDialogOpen} onOpenChange={setPostDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Post Benefit Contribution Run</DialogTitle>
                        <DialogDescription>Posts approved benefit contribution runs using the configured GL mapping.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Approved contribution runs</label>
                            <Select value={postForm.run_id} onValueChange={(value) => setPostForm(prev => ({ ...prev, run_id: value }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select approved run" />
                                </SelectTrigger>
                                <SelectContent>
                                    {contributionRuns.filter(run => run.status === 'approved').map(run => (
                                        <SelectItem key={run.id} value={run.id}>
                                            {run.period_start} → {run.period_end} • {run.total_amount ?? 0} {run.currency ?? 'MYR'}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contribution run ID</label>
                            <Input
                                value={postForm.run_id}
                                onChange={(e) => setPostForm(prev => ({ ...prev, run_id: e.target.value }))}
                                placeholder="Run UUID"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Override amount (optional)</label>
                            <Input
                                type="number"
                                value={postForm.amount}
                                onChange={(e) => setPostForm(prev => ({ ...prev, amount: e.target.value }))}
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPostDialogOpen(false)} disabled={saving}>Close</Button>
                        <Button onClick={handlePostContributionRun} disabled={saving}>Post to GL</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
