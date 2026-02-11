'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Bot,
    Plus,
    Trash2,
    Edit2,
    Loader2,
    AlertTriangle,
    Shield,
    Info,
    MessageSquare,
    Power,
    Zap,
    User
} from 'lucide-react'
import { format } from 'date-fns'

interface BotAdmin {
    id: string
    phone_digits: string
    display_name: string | null
    is_active: boolean
    created_at: string
}

export default function BotAdminSection() {
    const [admins, setAdmins] = useState<BotAdmin[]>([])
    const [loading, setLoading] = useState(true)

    // Global AI Auto Mode State
    const [globalAiEnabled, setGlobalAiEnabled] = useState(true)
    const [aiModeLoading, setAiModeLoading] = useState(false)

    // Add/Edit admin dialog
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingAdmin, setEditingAdmin] = useState<BotAdmin | null>(null)
    const [newPhone, setNewPhone] = useState('')
    const [newName, setNewName] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Fetch admins list
    const fetchAdmins = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/whatsapp/admins')
            const data = await res.json()
            if (data.ok) {
                setAdmins(data.admins || [])
            }
        } catch (err: any) {
            console.error('Failed to fetch bot admins:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    // Fetch global AI mode status
    const fetchGlobalAiMode = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/whatsapp/ai-mode')
            const data = await res.json()
            if (data.ok) {
                setGlobalAiEnabled(data.mode === 'auto')
            }
        } catch (err: any) {
            console.error('Failed to fetch AI mode:', err)
        }
    }, [])

    // Toggle global AI mode
    const handleToggleGlobalAi = async (enabled: boolean) => {
        setAiModeLoading(true)
        try {
            const res = await fetch('/api/admin/whatsapp/ai-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: enabled ? 'auto' : 'takeover' })
            })
            const data = await res.json()
            if (data.ok) {
                setGlobalAiEnabled(enabled)
            }
        } catch (err: any) {
            console.error('Failed to toggle AI mode:', err)
        } finally {
            setAiModeLoading(false)
        }
    }

    useEffect(() => {
        fetchAdmins()
        fetchGlobalAiMode()
    }, [fetchAdmins, fetchGlobalAiMode])

    const MAX_BOT_ADMINS = 3

    // Add/update admin
    const handleSaveAdmin = async () => {
        if (!newPhone.trim()) {
            setError('Phone number is required')
            return
        }

        // Enforce max 3 admins on add (not edit)
        if (!editingAdmin && admins.length >= MAX_BOT_ADMINS) {
            setError(`Maximum ${MAX_BOT_ADMINS} bot admins allowed. Remove one before adding a new admin.`)
            return
        }

        setSaving(true)
        setError(null)

        try {
            const url = editingAdmin
                ? `/api/admin/whatsapp/admins/${editingAdmin.id}`
                : '/api/admin/whatsapp/admins'

            const res = await fetch(url, {
                method: editingAdmin ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: newPhone,
                    displayName: newName || null
                })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to save admin')
            }

            setDialogOpen(false)
            setNewPhone('')
            setNewName('')
            setEditingAdmin(null)
            fetchAdmins()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    // Toggle admin active status
    const handleToggleActive = async (admin: BotAdmin) => {
        try {
            const res = await fetch(`/api/admin/whatsapp/admins/${admin.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !admin.is_active })
            })

            if (res.ok) {
                fetchAdmins()
            }
        } catch (err: any) {
            console.error('Failed to toggle admin:', err)
        }
    }

    // Delete admin
    const handleDeleteAdmin = async (admin: BotAdmin) => {
        if (!confirm(`Remove ${admin.display_name || admin.phone_digits} from bot admins?`)) {
            return
        }

        try {
            const res = await fetch(`/api/admin/whatsapp/admins/${admin.id}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                fetchAdmins()
            }
        } catch (err: any) {
            console.error('Failed to delete admin:', err)
        }
    }

    // Format phone for display
    const formatPhone = (phone: string) => {
        if (phone.startsWith('60')) {
            return `+${phone.slice(0, 2)} ${phone.slice(2, 5)}-${phone.slice(5)}`
        }
        return `+${phone}`
    }

    const openAddDialog = () => {
        setEditingAdmin(null)
        setNewPhone('')
        setNewName('')
        setError(null)
        setDialogOpen(true)
    }

    const openEditDialog = (admin: BotAdmin) => {
        setEditingAdmin(admin)
        setNewPhone(admin.phone_digits)
        setNewName(admin.display_name || '')
        setError(null)
        setDialogOpen(true)
    }

    return (
        <div className="space-y-6">
            {/* Global AI Auto-Reply Control - MOST IMPORTANT */}
            <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${globalAiEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                                {globalAiEnabled ? (
                                    <Zap className="w-6 h-6 text-green-600" />
                                ) : (
                                    <User className="w-6 h-6 text-gray-500" />
                                )}
                            </div>
                            <div>
                                <CardTitle className="text-lg">AI Auto-Reply</CardTitle>
                                <CardDescription>
                                    {globalAiEnabled
                                        ? 'AI bot is actively responding to customer messages'
                                        : 'AI is disabled. Human agents handle all conversations.'}
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Badge
                                variant="outline"
                                className={`text-sm px-3 py-1 ${globalAiEnabled
                                    ? 'bg-green-100 text-green-700 border-green-300'
                                    : 'bg-gray-100 text-gray-600 border-gray-300'}`}
                            >
                                {globalAiEnabled ? 'AUTO' : 'MANUAL'}
                            </Badge>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="global-ai-toggle"
                                    checked={globalAiEnabled}
                                    onCheckedChange={handleToggleGlobalAi}
                                    disabled={aiModeLoading}
                                    className="data-[state=checked]:bg-green-600"
                                />
                                <Label
                                    htmlFor="global-ai-toggle"
                                    className={`text-sm font-medium cursor-pointer ${globalAiEnabled ? 'text-green-700' : 'text-gray-500'}`}
                                >
                                    {aiModeLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : globalAiEnabled ? (
                                        'ON'
                                    ) : (
                                        'OFF'
                                    )}
                                </Label>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className={`p-3 rounded-lg text-sm ${globalAiEnabled ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                        {globalAiEnabled ? (
                            <p className="text-green-700 flex items-center gap-2">
                                <Bot className="w-4 h-4" />
                                <span><strong>AI is ON</strong> — The bot will automatically reply to all incoming WhatsApp messages. Support Inbox shows AI controls.</span>
                            </p>
                        ) : (
                            <p className="text-amber-700 flex items-center gap-2">
                                <User className="w-4 h-4" />
                                <span><strong>AI is OFF</strong> — All AI features are hidden in Support Inbox. Human agents handle conversations manually.</span>
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Bot Admins Management */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Shield className="w-5 h-5" />
                                Bot Admin Numbers
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-4 h-4 text-gray-400 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p>Bot admins can control the AI bot via WhatsApp commands. This does not grant system access or admin permissions.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </CardTitle>
                            <CardDescription className="mt-1">
                                Only WhatsApp numbers listed here are allowed to control the AI bot using /ai commands such as pausing auto-replies or generating drafts.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{admins.length}/{MAX_BOT_ADMINS} admins</Badge>
                            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button onClick={openAddDialog} size="sm" disabled={admins.length >= MAX_BOT_ADMINS}>
                                        <Plus className="w-4 h-4 mr-2" />
                                        {admins.length >= MAX_BOT_ADMINS ? 'Max Reached' : 'Add Admin'}
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>
                                            {editingAdmin ? 'Edit Bot Admin' : 'Add Bot Admin'}
                                        </DialogTitle>
                                        <DialogDescription>
                                            This phone number will be able to use /ai commands to control the bot
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="phone">Phone Number</Label>
                                            <Input
                                                id="phone"
                                                placeholder="e.g. 60192277233 or 0192277233"
                                                value={newPhone}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPhone(e.target.value)}
                                            />
                                            <p className="text-xs text-gray-500">
                                                Enter phone number with country code (60) or local format (0)
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Display Name (Optional)</Label>
                                            <Input
                                                id="name"
                                                placeholder="e.g. Edi Admin"
                                                value={newName}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                                            />
                                        </div>
                                        {error && (
                                            <div className="text-sm text-red-600 flex items-center gap-1">
                                                <AlertTriangle className="w-4 h-4" />
                                                {error}
                                            </div>
                                        )}
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button onClick={handleSaveAdmin} disabled={saving}>
                                            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                            {editingAdmin ? 'Save Changes' : 'Add Admin'}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : admins.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                            <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium text-gray-700">No bot admins configured</p>
                            <p className="text-sm mt-1 max-w-sm mx-auto">
                                Add trusted WhatsApp numbers that are allowed to pause auto-replies, take over conversations, and send AI drafts via WhatsApp.
                            </p>
                            <p className="text-xs text-amber-600 mt-3 flex items-center justify-center gap-1">
                                <Info className="w-3 h-3" />
                                Recommended: Add at least one admin number for manual takeover.
                            </p>
                            <Button onClick={openAddDialog} size="sm" className="mt-4" disabled={admins.length >= MAX_BOT_ADMINS}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add First Admin
                            </Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Phone Number</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Added</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {admins.map((admin) => (
                                    <TableRow key={admin.id}>
                                        <TableCell className="font-mono">
                                            {formatPhone(admin.phone_digits)}
                                        </TableCell>
                                        <TableCell>
                                            {admin.display_name || <span className="text-gray-400">-</span>}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={admin.is_active}
                                                    onCheckedChange={() => handleToggleActive(admin)}
                                                />
                                                <Badge variant={admin.is_active ? 'default' : 'secondary'}>
                                                    {admin.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-gray-500">
                                            {format(new Date(admin.created_at), 'dd/MM/yyyy')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditDialog(admin)}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-600 hover:text-red-700"
                                                    onClick={() => handleDeleteAdmin(admin)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {/* Command Reference */}
                    <Separator className="my-6" />
                    <div className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                            <Bot className="w-4 h-4" />
                            Available /ai Commands
                        </h4>
                        <p className="text-xs text-gray-500 bg-blue-50 p-2 rounded border border-blue-100">
                            <Info className="w-3 h-3 inline mr-1" />
                            These commands can only be used by numbers listed as Bot Admins above.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai auto on
                                <span className="text-gray-500 ml-2">- Enable auto-reply</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai auto off
                                <span className="text-gray-500 ml-2">- Disable auto-reply (takeover)</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai draft
                                <span className="text-gray-500 ml-2">- Generate AI draft</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai send
                                <span className="text-gray-500 ml-2">- Send pending draft</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai reply
                                <span className="text-gray-500 ml-2">- Generate and send AI reply</span>
                            </div>
                            <div className="p-2 bg-gray-50 rounded font-mono">
                                /ai summarize
                                <span className="text-gray-500 ml-2">- Summarize conversation</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
