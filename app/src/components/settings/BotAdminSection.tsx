'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
    Shield
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

    useEffect(() => {
        fetchAdmins()
    }, [fetchAdmins])

    // Add/update admin
    const handleSaveAdmin = async () => {
        if (!newPhone.trim()) {
            setError('Phone number is required')
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
            {/* Bot Admins Management */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Shield className="w-5 h-5" />
                                Bot Admin Numbers
                            </CardTitle>
                            <CardDescription>
                                Phone numbers authorized to use /ai commands via WhatsApp
                            </CardDescription>
                        </div>
                        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                            <DialogTrigger asChild>
                                <Button onClick={openAddDialog} size="sm">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Admin
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
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : admins.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">No bot admins configured</p>
                            <p className="text-sm">Add phone numbers that can use /ai commands</p>
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
