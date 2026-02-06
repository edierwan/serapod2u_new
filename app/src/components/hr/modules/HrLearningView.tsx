'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { BookOpen, Award, Users } from 'lucide-react'

interface Course {
    id: string
    title: string
    category?: string | null
    is_active: boolean
}

interface Enrollment {
    id: string
    status: string
}

interface Certification {
    id: string
    name: string
}

export default function HrLearningView() {
    const [courses, setCourses] = useState<Course[]>([])
    const [enrollments, setEnrollments] = useState<Enrollment[]>([])
    const [certifications, setCertifications] = useState<Certification[]>([])
    const [loading, setLoading] = useState(true)
    const [courseDialogOpen, setCourseDialogOpen] = useState(false)
    const [courseForm, setCourseForm] = useState({ title: '', category: '' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [coursesRes, enrollmentsRes, certificationsRes] = await Promise.all([
            fetch('/api/hr/learning/courses'),
            fetch('/api/hr/learning/enrollments'),
            fetch('/api/hr/learning/certifications')
        ])
        const coursesJson = await coursesRes.json()
        const enrollmentsJson = await enrollmentsRes.json()
        const certificationsJson = await certificationsRes.json()
        setCourses(coursesJson.data || [])
        setEnrollments(enrollmentsJson.data || [])
        setCertifications(certificationsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateCourse = async () => {
        if (!courseForm.title.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/learning/courses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: courseForm.title.trim(),
                category: courseForm.category.trim() || null
            })
        })
        setSaving(false)
        if (res.ok) {
            setCourseDialogOpen(false)
            setCourseForm({ title: '', category: '' })
            await load()
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Learning & Development</CardTitle>
                            <CardDescription>Deliver training, track certifications, and build a skills matrix.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setCourseDialogOpen(true)}>Add Course</Button>
                            <Button>Create Enrollment</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Courses</p>
                            <p className="text-2xl font-semibold">{courses.length}</p>
                        </div>
                        <BookOpen className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Enrollments</p>
                            <p className="text-2xl font-semibold">{enrollments.length}</p>
                        </div>
                        <Users className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Certifications</p>
                            <p className="text-2xl font-semibold">{certifications.length}</p>
                        </div>
                        <Award className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Course Catalog</CardTitle>
                    <CardDescription>Active courses available for enrollments.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading courses...</div>
                    ) : courses.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No courses configured.</div>
                    ) : (
                        <div className="space-y-3">
                            {courses.map(course => (
                                <div key={course.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-medium">{course.title}</div>
                                        <div className="text-sm text-muted-foreground">{course.category || 'General'}</div>
                                    </div>
                                    <Badge variant={course.is_active ? 'default' : 'secondary'}>
                                        {course.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Course</DialogTitle>
                        <DialogDescription>Add a training course to the catalog.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Course title</label>
                            <Input
                                value={courseForm.title}
                                onChange={(e) => setCourseForm(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="Safety Training"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Category</label>
                            <Input
                                value={courseForm.category}
                                onChange={(e) => setCourseForm(prev => ({ ...prev, category: e.target.value }))}
                                placeholder="Compliance"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCourseDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateCourse} disabled={saving}>Save Course</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
