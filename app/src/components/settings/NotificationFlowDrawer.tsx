'use client'

import { useState, useEffect } from 'react'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "../ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { Textarea } from "../ui/textarea"
import { RadioGroup, RadioGroupItem } from "../ui/radio-group"
import { Checkbox } from "../ui/checkbox"
import { Card, CardContent } from "../ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Badge } from "../ui/badge"
import { 
    GitBranch, Users, MessageSquare, TestTube, History, 
    ArrowRight, CheckCircle2, AlertCircle, Loader2, Play
} from 'lucide-react'
import { ScrollArea } from "../ui/scroll-area"
import { UserMultiSelect } from "./recipients/UserMultiSelect"
import { getTemplatesForEvent, Template } from "@/config/notificationTemplates"
import { useEffect, useState } from "react";

interface NotificationFlowDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    setting: any
    type: any
    onSave: (updates: any) => void
}

export default function NotificationFlowDrawer({ 
    open, 
    onOpenChange, 
    setting, 
    type,
    onSave 
}: NotificationFlowDrawerProps) {
    if (!setting || !type) return null

    const [activeTab, setActiveTab] = useState('flow')
    // Local state for edits
    const [localSetting, setLocalSetting] = useState(setting)
    
    // Preview State
    const [sampleId, setSampleId] = useState('')
    const [resolving, setResolving] = useState(false)
    const [resolvedRecipients, setResolvedRecipients] = useState<any[]>([])
    
    // Test Send State
    const [testSending, setTestSending] = useState(false)
    const [testResult, setTestResult] = useState<any>(null)
    
    // Logs
    const [logs, setLogs] = useState<any[]>([])
    const [loadingLogs, setLoadingLogs] = useState(false)

    useEffect(() => {
        const safeSetting = {
            ...setting,
            enabled: setting?.enabled ?? false,
            recipient_config: {
                include_consumer: false,
                type: 'roles',
                roles: [],
                recipient_users: [], // Ensure this array exists
                ...setting?.recipient_config
            },
            channels_enabled: setting?.channels_enabled || [],
            templates: setting?.templates || {}
        }
        setLocalSetting(safeSetting)
        setResolvedRecipients([])
        setSampleId('')
        setTestResult(null)
    }, [setting, open])

    useEffect(() => {
        if (activeTab === 'logs' && open) {
            fetchLogs()
        }
    }, [activeTab, open])

    const fetchLogs = async () => {
        setLoadingLogs(true)
        try {
            const res = await fetch(`/api/notifications/logs?eventCode=${type.event_code}`)
            const data = await res.json()
            if (data.success) {
                setLogs(data.logs)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setLoadingLogs(false)
        }
    }

    const updateRecipientConfig = (updates: any) => {
        setLocalSetting((prev: any) => ({
            ...prev,
            recipient_config: { ...prev.recipient_config, ...updates }
        }))
    }

    const updateTemplate = (channel: string, text: string) => {
        setLocalSetting((prev: any) => ({
            ...prev,
            templates: { ...prev.templates, [channel]: text }
        }))
    }

    const handleResolve = async () => {
        if (!sampleId) return
        setResolving(true)
        try {
            const params = new URLSearchParams({
                eventCode: type.event_code,
                sampleId: sampleId,
                recipientConfig: JSON.stringify(localSetting.recipient_config)
            })
            const res = await fetch(`/api/notifications/resolve?${params}`)
            const data = await res.json()
            if (data.success) {
                setResolvedRecipients(data.recipients)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setResolving(false)
        }
    }

    const handleTestSend = async () => {
        if (!resolvedRecipients.length) return
        setTestSending(true)
        setTestResult(null)
        try {
            // Pick first resolved recipient for test
            const target = resolvedRecipients[0]
            // Pick first enabled channel
            const channel = localSetting.channels_enabled[0] || 'whatsapp'
            
            const res = await fetch('/api/notifications/test-send', {
                method: 'POST',
                body: JSON.stringify({
                    eventCode: type.event_code,
                    channel,
                    recipient: target,
                    template: localSetting.templates?.[channel],
                    sampleData: { order_no: sampleId, amount: '120.00' } // Mock vars for now
                })
            })
            const data = await res.json()
            setTestResult(data)
            if (data.success) fetchLogs() // refresh logs
        } catch (error) {
            console.error(error)
            setTestResult({ error: 'Failed to send' })
        } finally {
            setTestSending(false)
        }
    }

    const handleSave = () => {
        onSave(localSetting)
        onOpenChange(false)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[90vw] sm:max-w-xl overflow-y-auto sm:p-0">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b bg-gray-50/50">
                        <SheetHeader>
                            <SheetTitle className="text-xl flex items-center gap-2">
                                {type.event_name}
                            </SheetTitle>
                            <SheetDescription>
                                {type.event_description}
                            </SheetDescription>
                        </SheetHeader>
                        
                        <div className="flex items-center gap-2 mt-4">
                             {localSetting.enabled ? (
                                <Badge className="bg-green-600">Active</Badge>
                             ) : (
                                <Badge variant="secondary">Disabled</Badge>
                             )}
                             <span className="text-xs text-gray-500 mx-2">|</span>
                             <div className="flex gap-1">
                                {type.available_channels.map((c: string) => (
                                    <Badge key={c} variant={localSetting.channels_enabled.includes(c) ? 'default' : 'outline'} className="capitalize">
                                        {c}
                                    </Badge>
                                ))}
                             </div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                        <div className="px-6 pt-4 border-b">
                            <TabsList className="w-full justify-start h-auto p-0 bg-transparent gap-6">
                                <TabsTrigger value="flow" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-2 gap-2">
                                    <GitBranch className="w-4 h-4" /> Flow
                                </TabsTrigger>
                                <TabsTrigger value="recipients" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-2 gap-2">
                                    <Users className="w-4 h-4" /> Recipients
                                </TabsTrigger>
                                <TabsTrigger value="templates" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-2 gap-2">
                                    <MessageSquare className="w-4 h-4" /> Templates
                                </TabsTrigger>
                                <TabsTrigger value="test" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 px-4 py-2 gap-2">
                                    <TestTube className="w-4 h-4" /> Test & Logs
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            {/* Flow Visualization */}
                            <TabsContent value="flow" className="mt-0 space-y-8">
                                <div className="relative">
                                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
                                    
                                    <div className="relative flex gap-4 items-start mb-8">
                                        <div className="w-8 h-8 rounded-full bg-blue-100 border-2 border-blue-500 flex items-center justify-center shrink-0 z-10">
                                            <Play className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">Trigger Event</h4>
                                            <p className="text-sm text-gray-500">{type.event_name} occurs in system</p>
                                        </div>
                                    </div>

                                    <div className="relative flex gap-4 items-start mb-8">
                                        <div className="w-8 h-8 rounded-full bg-purple-100 border-2 border-purple-500 flex items-center justify-center shrink-0 z-10">
                                            <Users className="w-4 h-4 text-purple-600" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">Resolve Recipients</h4>
                                            <p className="text-sm text-gray-500">
                                                {localSetting.recipient_config?.type === 'dynamic' 
                                                    ? `Dynamic: ${localSetting.recipient_config.dynamic_target}` 
                                                    : `Fixed Roles: ${(localSetting.recipient_config?.roles || []).join(', ')}`}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="relative flex gap-4 items-start mb-8">
                                        <div className="w-8 h-8 rounded-full bg-orange-100 border-2 border-orange-500 flex items-center justify-center shrink-0 z-10">
                                            <GitBranch className="w-4 h-4 text-orange-600" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">Routing & Templates</h4>
                                            <div className="flex gap-2 mt-1">
                                                {localSetting.channels_enabled.map((c: string) => (
                                                    <Badge key={c} variant="outline" className="text-xs bg-white">
                                                        {c} ({localSetting.templates?.[c] ? 'Template set' : 'No template'})
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative flex gap-4 items-start">
                                        <div className="w-8 h-8 rounded-full bg-green-100 border-2 border-green-500 flex items-center justify-center shrink-0 z-10">
                                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">Delivery</h4>
                                            <p className="text-sm text-gray-500">Sent via configured providers (Baileys/Twilio/etc)</p>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Recipients Configuration */}
                            <TabsContent value="recipients" className="mt-0 space-y-6">
                                {/* Rule Configuration */}
                                <Card>
                                    <CardContent className="pt-6 space-y-6">
                                    <h4 className="font-medium text-sm text-gray-900">Consumer Settings</h4>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox 
                                            checked={!!localSetting.recipient_config?.include_consumer}
                                            onCheckedChange={(c) => updateRecipientConfig({ include_consumer: c as boolean })}
                                        />
                                        <span className="text-sm">Send to relevant Consumer</span>
                                    </label>

                                    <div className="pt-4 border-t">
                                        <h4 className="font-medium text-sm text-gray-900 mb-3">Staff & Organization Recipients</h4>
                                        <RadioGroup 
                                            value={localSetting.recipient_config?.type || 'roles'}
                                            onValueChange={(val) => updateRecipientConfig({ type: val as any })}
                                            className="space-y-4"
                                        >
                                            <div className="space-y-2">
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="roles" id="r-roles" />
                                                    <Label htmlFor="r-roles">Send to specific roles</Label>
                                                </div>
                                                {localSetting.recipient_config?.type === 'roles' && (
                                                    <div className="ml-6 grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded text-sm">
                                                        {['super_admin', 'admin', 'distributor', 'warehouse'].map(role => (
                                                            <label key={role} className="flex items-center gap-2 cursor-pointer">
                                                                <Checkbox 
                                                                    checked={!!localSetting.recipient_config?.roles?.includes(role)}
                                                                    onCheckedChange={(c) => {
                                                                        const currentRoles = localSetting.recipient_config?.roles || []
                                                                        const newRoles = c 
                                                                            ? [...currentRoles, role]
                                                                            : currentRoles.filter((r:string) => r !== role)
                                                                        updateRecipientConfig({ roles: newRoles })
                                                                    }}
                                                                />
                                                                <span className="capitalize">{role.replace('_', ' ')}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="dynamic" id="r-dynamic" />
                                                    <Label htmlFor="r-dynamic">Dynamic (Related Organization)</Label>
                                                </div>
                                                {localSetting.recipient_config?.type === 'dynamic' && (
                                                    <div className="ml-6 p-3 bg-gray-50 rounded">
                                                       <Select 
                                                            value={localSetting.recipient_config?.dynamic_target || ''}
                                                            onValueChange={(val) => updateRecipientConfig({ dynamic_target: val })}
                                                       >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select target..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="manufacturer">Manufacturer (Product Owner)</SelectItem>
                                                                <SelectItem value="distributor">Distributor (Seller)</SelectItem>
                                                                <SelectItem value="warehouse">Warehouse</SelectItem>
                                                            </SelectContent>
                                                       </Select>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                 <div className="flex items-center space-x-2">
                                                    <RadioGroupItem value="users" id="r-users" />
                                                    <Label htmlFor="r-users">Specific Users</Label>
                                                </div>
                                                {localSetting.recipient_config?.type === 'users' && (
                                                    <div className="ml-6 p-3 bg-gray-50 rounded space-y-2">
                                                        <Label className="text-xs text-gray-500">Search and select users to receive this notification</Label>
                                                        <UserMultiSelect 
                                                            selectedUserIds={localSetting.recipient_config?.recipient_users || []}
                                                            onSelectionChange={(ids) => updateRecipientConfig({ recipient_users: ids })}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </RadioGroup>
                                    </div>
                                    </CardContent>
                                </Card>

                                {/* Preview Section */}
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-sm">Preview Resolution</h4>
                                    <div className="flex gap-2">
                                        <Input 
                                            placeholder="Enter Sample ID (e.g. Order No)" 
                                            value={sampleId}
                                            onChange={(e) => setSampleId(e.target.value)}
                                        />
                                        <Button 
                                            variant="outline" 
                                            onClick={handleResolve}
                                            disabled={resolving || !sampleId}
                                        >
                                            {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Resolve'}
                                        </Button>
                                    </div>
                                    
                                    {resolvedRecipients.length > 0 && (
                                        <div className="border rounded-md divide-y max-h-[150px] overflow-y-auto">
                                            {resolvedRecipients.map((r, i) => (
                                                <div key={i} className="p-2 text-sm flex justify-between items-center bg-gray-50">
                                                    <div>
                                                        <div className="font-medium">{r.full_name}</div>
                                                        <div className="text-gray-500 text-xs">{r.email || r.phone}</div>
                                                    </div>
                                                    <Badge variant="outline">{r.type}</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            {/* Templates Editor */}
                            <TabsContent value="templates" className="mt-0 space-y-6">
                                <Tabs defaultValue={localSetting.channels_enabled[0] || 'whatsapp'}>
                                    <TabsList className="w-full justify-start gap-2 h-auto p-1 bg-gray-100">
                                        {type.available_channels.map((c: string) => (
                                            <TabsTrigger key={c} value={c} className="capitalize">{c}</TabsTrigger>
                                        ))}
                                    </TabsList>
                                    
                                    {type.available_channels.map((channel: string) => {
                                        const templatesForChannel = getTemplatesForEvent(type.event_code, channel);
                                        const currentTemplate = localSetting.templates?.[channel] || '';
                                        
                                        // Simple local mock resolution
                                        const resolvePreview = (tpl: string) => {
                                           const vars: any = {
                                               order_no: sampleId || 'ORD-2026-001',
                                               status: 'APPROVED',
                                               amount: '1,250.00',
                                               customer_name: 'John Doe',
                                               approved_by: 'Admin User',
                                               order_url: 'https://app.serapod.com/orders/1',
                                               sku: 'PRD-001',
                                               product_name: 'Super Pod V2',
                                               stock_level: '15',
                                               threshold: '20',
                                               inventory_url: 'https://app.serapod.com/inventory',
                                               code: 'ABC-123',
                                               verify_url: 'https://app.serapod.com/verify/123',
                                               user_name: 'Jane Smith',
                                               email: 'jane@example.com',
                                               phone_number: '+60123456789',
                                               reason: 'Out of stock'
                                           }
                                           let res = tpl || ''
                                           Object.keys(vars).forEach(k => {
                                               res = res.replace(new RegExp(`{{${k}}}`, 'g'), vars[k])
                                           })
                                           return res
                                        }

                                        return (
                                            <TabsContent key={channel} value={channel} className="space-y-4 pt-4">
                                                {!localSetting.channels_enabled.includes(channel) && (
                                                    <div className="p-3 bg-amber-50 text-amber-800 text-xs border border-amber-200">
                                                        Channel disabled
                                                    </div>
                                                )}
                                                
                                                {/* Template Library */}
                                                <div className="space-y-2">
                                                    <Label>Template Library</Label>
                                                    <Select onValueChange={(val) => {
                                                        const selected = templatesForChannel.find(t => t.id === val);
                                                        if (selected) updateTemplate(channel, selected.body);
                                                    }}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Choose a template..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {templatesForChannel.length > 0 ? (
                                                                templatesForChannel.map(t => (
                                                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                                                ))
                                                            ) : (
                                                                <div className="p-2 text-xs text-gray-500 text-center">No preset templates</div>
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>Message Content</Label>
                                                    <Textarea 
                                                        placeholder={`Enter ${channel} message content...`}
                                                        className="min-h-[150px] font-mono text-sm"
                                                        value={currentTemplate}
                                                        onChange={(e) => updateTemplate(channel, e.target.value)}
                                                    />
                                                    <div className="text-xs text-gray-500">
                                                        Variables: {"{{order_no}}, {{status}}, {{customer_name}}, {{amount}}"}
                                                    </div>
                                                </div>

                                                {/* Example Output */}
                                                <Card className="bg-gray-50/50">
                                                    <CardContent className="pt-4 pb-4">
                                                        <Label className="text-xs text-gray-500 uppercase mb-2 block">Example Output</Label>
                                                        {channel === 'email' ? (
                                                            <div className="space-y-2 text-sm bg-white p-3 border rounded">
                                                                <div className="border-b pb-2 mb-2 font-medium">Subject: Notification Subject</div>
                                                                <pre className="whitespace-pre-wrap font-sans text-gray-700">
                                                                    {resolvePreview(currentTemplate)}
                                                                </pre>
                                                            </div>
                                                        ) : (
                                                            <div className="bg-white p-3 border rounded-lg text-sm whitespace-pre-wrap relative">
                                                                <div className="absolute -left-1 top-3 w-0 h-0 border-t-[6px] border-t-transparent border-r-[8px] border-r-white border-b-[6px] border-b-transparent"></div>
                                                                {resolvePreview(currentTemplate) || <span className="text-gray-400 italic">No content</span>}
                                                            </div>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            </TabsContent>
                                        )
                                    })}
                                </Tabs>
                            </TabsContent>

                            {/* Test & Logs */}
                            <TabsContent value="test" className="mt-0 space-y-6">
                                <Card>
                                    <CardContent className="pt-6 space-y-4">
                                        <h4 className="font-medium text-sm">Send Test Message</h4>
                                        <div className="text-sm text-gray-500">
                                            Will send using the template from current settings to the first resolved recipient from "Recipients" tab.
                                        </div>
                                        {resolvedRecipients.length === 0 ? (
                                            <div className="p-3 bg-amber-50 text-amber-800 text-sm border border-amber-200">
                                                Please resolve recipients in "Recipients" tab first.
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-blue-50 text-blue-800 text-sm border border-blue-200 flex justify-between items-center">
                                                <span>To: {resolvedRecipients[0].full_name} ({resolvedRecipients[0].phone || resolvedRecipients[0].email})</span>
                                                <Badge variant="outline">Preview</Badge>
                                            </div>
                                        )}
                                        
                                        <Button 
                                            className="w-full" 
                                            onClick={handleTestSend} 
                                            disabled={testSending || resolvedRecipients.length === 0}
                                        >
                                            {testSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <TestTube className="w-4 h-4 mr-2" />}
                                            Send Test Message
                                        </Button>

                                        {testResult && (
                                            <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                                {testResult.success ? 'Test message sent successfully!' : `Failed: ${testResult.error}`}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-semibold text-sm">Recent Deliveries</h4>
                                        <Button variant="ghost" size="sm" onClick={fetchLogs}>
                                            <History className="w-3 h-3 mr-1" /> Refresh
                                        </Button>
                                    </div>
                                    
                                    <div className="border rounded-md divide-y text-sm">
                                        {logs.map((log) => (
                                            <div key={log.id} className="p-3 flex justify-between items-start hover:bg-gray-50">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{log.recipient}</span>
                                                        <Badge variant="outline" className="text-[10px] capitalize">{log.channel}</Badge>
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </div>
                                                </div>
                                                <Badge className={
                                                    log.status === 'sent' || log.status === 'delivered' ? 'bg-green-600' : 
                                                    log.status === 'failed' ? 'bg-red-600' : 'bg-gray-600'
                                                }>
                                                    {log.status}
                                                </Badge>
                                            </div>
                                        ))}
                                        {!loadingLogs && logs.length === 0 && (
                                            <div className="p-4 text-center text-gray-400">No logs found</div>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>

                    {/* Footer Actions */}
                    <div className="p-6 border-t bg-white mt-auto">
                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button onClick={handleSave}>Save Changes</Button>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
