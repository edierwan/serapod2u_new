'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ClipboardList, Users, CheckCircle2 } from 'lucide-react'

interface Template {
    id: string
    name: string
    description?: string | null
    is_active: boolean
}

interface Instance {
    id: string
    status: string
    start_date?: string | null
}

export default function HrOnboardingView() {
    const [templates, setTemplates] = useState<Template[]>([])
    const [instances, setInstances] = useState<Instance[]>([])
    const [loading, setLoading] = useState(true)
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
    const [instanceDialogOpen, setInstanceDialogOpen] = useState(false)
    const [templateForm, setTemplateForm] = useState({ name: '', description: '' })
    const [instanceForm, setInstanceForm] = useState({ employee_user_id: '', start_date: '' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [templatesRes, instancesRes] = await Promise.all([
            fetch('/api/hr/onboarding/templates'),
            fetch('/api/hr/onboarding/instances')
        ])
        const templatesJson = await templatesRes.json()
        const instancesJson = await instancesRes.json()
        setTemplates(templatesJson.data || [])
        setInstances(instancesJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateTemplate = async () => {
        if (!templateForm.name.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/onboarding/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: templateForm.name.trim(),
                description: templateForm.description.trim() || null
            })
        })
        setSaving(false)
        if (res.ok) {
            setTemplateDialogOpen(false)
            setTemplateForm({ name: '', description: '' })
            await load()
        }
    }

    const handleCreateInstance = async () => {
        if (!instanceForm.employee_user_id.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/onboarding/instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_user_id: instanceForm.employee_user_id.trim(),
                start_date: instanceForm.start_date || null
            })
        })
        setSaving(false)
        if (res.ok) {
            setInstanceDialogOpen(false)
            setInstanceForm({ employee_user_id: '', start_date: '' })
            await load()
        }
    }

    const activeTemplates = templates.filter(t => t.is_active).length

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Onboarding</CardTitle>
                            <CardDescription>Automate new hire paperwork, tasks, and orientation workflows.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>New Template</Button>
                            <Button onClick={() => setInstanceDialogOpen(true)}>Start Onboarding</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Active Templates</p>
                            <p className="text-2xl font-semibold">{activeTemplates}</p>
                        </div>
                        <ClipboardList className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">In Progress</p>
                            <p className="text-2xl font-semibold">{instances.filter(i => i.status === 'in_progress').length}</p>
                        </div>
                        <Users className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Completed</p>
                            <p className="text-2xl font-semibold">{instances.filter(i => i.status === 'completed').length}</p>
                        </div>
                        <CheckCircle2 className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Onboarding Templates</CardTitle>
                    <CardDescription>Reusable task blueprints for each role.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading templates...</div>
                    ) : templates.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No templates yet.</div>
                    ) : (
                        <div className="space-y-3">
                            {templates.map(template => (
                                <div key={template.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-medium">{template.name}</div>
                                        <div className="text-sm text-muted-foreground">{template.description || 'No description'}</div>
                                    </div>
                                    <Badge variant={template.is_active ? 'default' : 'secondary'}>
                                        {template.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Onboarding Template</DialogTitle>
                        <DialogDescription>Define a reusable onboarding blueprint.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Template name</label>
                            <Input
                                value={templateForm.name}
                                onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Sales onboarding"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Description</label>
                            <Input
                                value={templateForm.description}
                                onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Tasks, docs, and access for new hires"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTemplateDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateTemplate} disabled={saving}>Save Template</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={instanceDialogOpen} onOpenChange={setInstanceDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Start Onboarding</DialogTitle>
                        <DialogDescription>Create an onboarding instance for a new hire.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee User ID</label>
                            <Input
                                value={instanceForm.employee_user_id}
                                onChange={(e) => setInstanceForm(prev => ({ ...prev, employee_user_id: e.target.value }))}
                                placeholder="UUID"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Start date</label>
                            <Input
                                type="date"
                                value={instanceForm.start_date}
                                onChange={(e) => setInstanceForm(prev => ({ ...prev, start_date: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInstanceDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateInstance} disabled={saving}>Start</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
