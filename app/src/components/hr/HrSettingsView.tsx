'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { getHrSettings, saveHrSettings, type HrSettingsConfig } from '@/lib/actions/hrSettings'

interface HrSettingsViewProps {
    organizationId: string
    canEdit: boolean
}

export default function HrSettingsView({ organizationId, canEdit }: HrSettingsViewProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [config, setConfig] = useState<HrSettingsConfig>({
        work_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        working_hours: { start: '09:00', end: '18:00' },
        holidays_region: 'Malaysia',
        approval_defaults: {
            fallback_to_department_manager: true,
            fallback_to_management_manager: true
        }
    })

    const { toast } = useToast()

    useEffect(() => {
        const load = async () => {
            setLoading(true)
            const result = await getHrSettings(organizationId)
            if (result.success && result.data) {
                setConfig({
                    ...config,
                    ...result.data
                })
            }
            setLoading(false)
        }
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId])

    const handleSave = async () => {
        setSaving(true)
        const result = await saveHrSettings(organizationId, config)
        if (result.success) {
            toast({ title: 'Saved', description: 'HR settings updated.' })
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to save settings', variant: 'destructive' })
        }
        setSaving(false)
    }

    if (loading) {
        return <div className="py-12 text-center text-gray-500">Loading HR settings...</div>
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">HR Settings</CardTitle>
                <CardDescription>Configure default HR policies (Phase 1).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-3">
                    <Label>Default Work Week</Label>
                    <div className="flex flex-wrap gap-3">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                            <label key={day} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={config.work_week?.includes(day) || false}
                                    onChange={(e) => {
                                        const current = new Set(config.work_week || [])
                                        if (e.target.checked) current.add(day)
                                        else current.delete(day)
                                        setConfig(prev => ({ ...prev, work_week: Array.from(current) }))
                                    }}
                                />
                                {day}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Default Working Hours (Start)</Label>
                        <Input
                            type="time"
                            value={config.working_hours?.start || '09:00'}
                            onChange={(e) => setConfig(prev => ({
                                ...prev,
                                working_hours: { start: e.target.value, end: prev.working_hours?.end || '18:00' }
                            }))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Default Working Hours (End)</Label>
                        <Input
                            type="time"
                            value={config.working_hours?.end || '18:00'}
                            onChange={(e) => setConfig(prev => ({
                                ...prev,
                                working_hours: { start: prev.working_hours?.start || '09:00', end: e.target.value }
                            }))}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Public Holidays Region</Label>
                    <Input
                        value={config.holidays_region || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, holidays_region: e.target.value }))}
                        placeholder="Malaysia"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Approval Defaults</Label>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={!!config.approval_defaults?.fallback_to_department_manager}
                            onCheckedChange={(checked) => setConfig(prev => ({
                                ...prev,
                                approval_defaults: {
                                    ...prev.approval_defaults,
                                    fallback_to_department_manager: checked
                                }
                            }))}
                        />
                        <span className="text-sm text-gray-600">Fallback to Department Manager</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={!!config.approval_defaults?.fallback_to_management_manager}
                            onCheckedChange={(checked) => setConfig(prev => ({
                                ...prev,
                                approval_defaults: {
                                    ...prev.approval_defaults,
                                    fallback_to_management_manager: checked
                                }
                            }))}
                        />
                        <span className="text-sm text-gray-600">Fallback to Management Department Manager</span>
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={!canEdit || saving}>
                        {saving ? 'Saving...' : 'Save Settings'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
