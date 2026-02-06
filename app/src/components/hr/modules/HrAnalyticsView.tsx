'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BarChart3, TrendingUp, ShieldCheck, FileText } from 'lucide-react'

interface KpiDefinition {
    id: string
    name: string
    kpi_key: string
    unit?: string | null
}

interface ReportDefinition {
    id: string
    name: string
    description?: string | null
}

export default function HrAnalyticsView() {
    const [kpis, setKpis] = useState<KpiDefinition[]>([])
    const [reports, setReports] = useState<ReportDefinition[]>([])
    const [loading, setLoading] = useState(true)
    const [kpiDialogOpen, setKpiDialogOpen] = useState(false)
    const [reportDialogOpen, setReportDialogOpen] = useState(false)
    const [kpiForm, setKpiForm] = useState({ name: '', kpi_key: '', unit: '' })
    const [reportForm, setReportForm] = useState({ name: '', description: '', config: '{}' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [kpiRes, reportRes] = await Promise.all([
            fetch('/api/hr/analytics/kpis'),
            fetch('/api/hr/analytics/reports')
        ])
        const kpiJson = await kpiRes.json()
        const reportJson = await reportRes.json()
        setKpis(kpiJson.data || [])
        setReports(reportJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateKpi = async () => {
        if (!kpiForm.name.trim() || !kpiForm.kpi_key.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/analytics/kpis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: kpiForm.name.trim(),
                kpi_key: kpiForm.kpi_key.trim(),
                unit: kpiForm.unit.trim() || null
            })
        })
        setSaving(false)
        if (res.ok) {
            setKpiDialogOpen(false)
            setKpiForm({ name: '', kpi_key: '', unit: '' })
            await load()
        }
    }

    const handleCreateReport = async () => {
        if (!reportForm.name.trim()) return
        let config: any = null
        try {
            config = JSON.parse(reportForm.config)
        } catch (error) {
            return
        }
        setSaving(true)
        const res = await fetch('/api/hr/analytics/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: reportForm.name.trim(),
                description: reportForm.description.trim() || null,
                config
            })
        })
        setSaving(false)
        if (res.ok) {
            setReportDialogOpen(false)
            setReportForm({ name: '', description: '', config: '{}' })
            await load()
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>HR Analytics & Reporting</CardTitle>
                            <CardDescription>Dashboards and KPI tracking for workforce, compliance, and cost.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setKpiDialogOpen(true)}>New KPI</Button>
                            <Button onClick={() => setReportDialogOpen(true)}>Create Report</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Active KPIs</p>
                            <p className="text-2xl font-semibold">{kpis.length}</p>
                        </div>
                        <BarChart3 className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Reports</p>
                            <p className="text-2xl font-semibold">{reports.length}</p>
                        </div>
                        <FileText className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Compliance</p>
                            <p className="text-2xl font-semibold">MY</p>
                        </div>
                        <ShieldCheck className="h-6 w-6 text-amber-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Trend</p>
                            <p className="text-2xl font-semibold">Stable</p>
                        </div>
                        <TrendingUp className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>KPI Definitions</CardTitle>
                        <CardDescription>Define and track KPI formulas for your org.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">Loading KPIs...</div>
                        ) : kpis.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">No KPIs configured.</div>
                        ) : (
                            <div className="space-y-3">
                                {kpis.map(kpi => (
                                    <div key={kpi.id} className="flex items-center justify-between rounded-lg border p-4">
                                        <div>
                                            <div className="font-medium">{kpi.name}</div>
                                            <div className="text-sm text-muted-foreground">{kpi.kpi_key}</div>
                                        </div>
                                        <Badge variant="outline">{kpi.unit || 'unit'}</Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Saved Reports</CardTitle>
                        <CardDescription>Reusable report templates for leaders and compliance.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">Loading reports...</div>
                        ) : reports.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">No reports saved.</div>
                        ) : (
                            <div className="space-y-3">
                                {reports.map(report => (
                                    <div key={report.id} className="rounded-lg border p-4">
                                        <div className="font-medium">{report.name}</div>
                                        <div className="text-sm text-muted-foreground">{report.description || 'Custom report'}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={kpiDialogOpen} onOpenChange={setKpiDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create KPI</DialogTitle>
                        <DialogDescription>Define a new KPI for analytics.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">KPI name</label>
                            <Input
                                value={kpiForm.name}
                                onChange={(e) => setKpiForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Headcount"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">KPI key</label>
                            <Input
                                value={kpiForm.kpi_key}
                                onChange={(e) => setKpiForm(prev => ({ ...prev, kpi_key: e.target.value }))}
                                placeholder="headcount"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Unit</label>
                            <Input
                                value={kpiForm.unit}
                                onChange={(e) => setKpiForm(prev => ({ ...prev, unit: e.target.value }))}
                                placeholder="people"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setKpiDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateKpi} disabled={saving}>Save KPI</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Report</DialogTitle>
                        <DialogDescription>Define a custom report configuration.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Report name</label>
                            <Input
                                value={reportForm.name}
                                onChange={(e) => setReportForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Monthly Headcount"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Description</label>
                            <Input
                                value={reportForm.description}
                                onChange={(e) => setReportForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Department headcount summary"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Config (JSON)</label>
                            <Textarea
                                value={reportForm.config}
                                onChange={(e) => setReportForm(prev => ({ ...prev, config: e.target.value }))}
                                rows={4}
                                placeholder='{"source": "users", "group_by": "department"}'
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReportDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateReport} disabled={saving}>Save Report</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
