'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Briefcase, Users, CalendarCheck2, FileText, Search } from 'lucide-react'

interface JobPosting {
    id: string
    title: string
    status: string
    location?: string | null
    employment_type?: string | null
    created_at: string
}

interface Applicant {
    id: string
    full_name: string
    email: string
    status: string
    created_at: string
}

export default function HrRecruitmentView() {
    const [jobs, setJobs] = useState<JobPosting[]>([])
    const [applicants, setApplicants] = useState<Applicant[]>([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [jobDialogOpen, setJobDialogOpen] = useState(false)
    const [jobForm, setJobForm] = useState({ title: '', location: '', employment_type: 'Full-time' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [jobsRes, applicantsRes] = await Promise.all([
            fetch('/api/hr/recruitment/jobs'),
            fetch('/api/hr/recruitment/applicants')
        ])

        const jobsJson = await jobsRes.json()
        const applicantsJson = await applicantsRes.json()

        setJobs(jobsJson.data || [])
        setApplicants(applicantsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateJob = async () => {
        if (!jobForm.title.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/recruitment/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: jobForm.title.trim(),
                location: jobForm.location.trim() || null,
                employment_type: jobForm.employment_type
            })
        })
        setSaving(false)
        if (res.ok) {
            setJobDialogOpen(false)
            setJobForm({ title: '', location: '', employment_type: 'Full-time' })
            await load()
        }
    }

    const filteredJobs = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return jobs
        return jobs.filter(job => job.title.toLowerCase().includes(q))
    }, [jobs, query])

    const stats = {
        openJobs: jobs.filter(j => j.status !== 'closed').length,
        applicants: applicants.length,
        interviews: 0,
        offers: 0
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Recruitment / ATS</CardTitle>
                            <CardDescription>Manage job postings, applicants, and offers with structured workflows.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setJobDialogOpen(true)}>Create Job</Button>
                            <Button>Publish Posting</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Open Jobs</p>
                            <p className="text-2xl font-semibold">{stats.openJobs}</p>
                        </div>
                        <Briefcase className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Applicants</p>
                            <p className="text-2xl font-semibold">{stats.applicants}</p>
                        </div>
                        <Users className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Interviews</p>
                            <p className="text-2xl font-semibold">{stats.interviews}</p>
                        </div>
                        <CalendarCheck2 className="h-6 w-6 text-amber-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Offers</p>
                            <p className="text-2xl font-semibold">{stats.offers}</p>
                        </div>
                        <FileText className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Job Postings</CardTitle>
                            <CardDescription>Track active openings and publishing status.</CardDescription>
                        </div>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search jobs"
                                className="pl-9"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading job postings...</div>
                    ) : filteredJobs.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No job postings yet.</div>
                    ) : (
                        <div className="space-y-3">
                            {filteredJobs.map(job => (
                                <div key={job.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-medium">{job.title}</div>
                                        <div className="text-sm text-muted-foreground">
                                            {job.location || 'Remote'} • {job.employment_type || 'Full-time'}
                                        </div>
                                    </div>
                                    <Badge variant={job.status === 'published' ? 'default' : 'secondary'}>
                                        {job.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Applicants</CardTitle>
                    <CardDescription>Latest candidates entering the pipeline.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading applicants...</div>
                    ) : applicants.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No applicants yet.</div>
                    ) : (
                        <div className="space-y-3">
                            {applicants.slice(0, 5).map(applicant => (
                                <div key={applicant.id} className="flex flex-col gap-1 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-medium">{applicant.full_name}</div>
                                        <div className="text-sm text-muted-foreground">{applicant.email}</div>
                                    </div>
                                    <Badge variant={applicant.status === 'new' ? 'default' : 'secondary'}>
                                        {applicant.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Job Posting</DialogTitle>
                        <DialogDescription>Define a new job opening.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Job title</label>
                            <Input
                                value={jobForm.title}
                                onChange={(e) => setJobForm(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="HR Manager"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Location</label>
                            <Input
                                value={jobForm.location}
                                onChange={(e) => setJobForm(prev => ({ ...prev, location: e.target.value }))}
                                placeholder="Kuala Lumpur"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employment type</label>
                            <Input
                                value={jobForm.employment_type}
                                onChange={(e) => setJobForm(prev => ({ ...prev, employment_type: e.target.value }))}
                                placeholder="Full-time"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setJobDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateJob} disabled={saving}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
