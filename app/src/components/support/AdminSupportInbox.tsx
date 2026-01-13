'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
    MessageSquare, 
    Search, 
    Filter, 
    RefreshCw, 
    Send, 
    Image as ImageIcon, 
    CheckCircle2, 
    Clock, 
    AlertCircle,
    MoreHorizontal,
    Megaphone,
    Loader2,
    User,
    ArrowLeft,
    X
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"

type Thread = {
    id: string
    case_id: string
    subject: string
    status: 'open' | 'pending' | 'resolved' | 'closed'
    priority: 'low' | 'normal' | 'high'
    last_message_preview: string
    last_message_at: string
    created_at: string
    created_by: {
        email: string
        full_name: string
        phone: string
    }
    assigned_to?: {
        email: string
        full_name: string
    }
    is_unread: boolean
}

type Message = {
    id: string
    sender_type: 'user' | 'admin' | 'system'
    body: string
    attachments: any[]
    created_at: string
}

export function AdminSupportInbox() {
    const [view, setView] = useState<'list' | 'detail'>('list')
    const [threads, setThreads] = useState<Thread[]>([])
    const [activeThread, setActiveThread] = useState<Thread | null>(null)
    const [loading, setLoading] = useState(false)
    const [statusFilter, setStatusFilter] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [showBlastModal, setShowBlastModal] = useState(false)
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1)
    const [rowsPerPage, setRowsPerPage] = useState(20)
    const [totalCount, setTotalCount] = useState(0)
    
    const totalPages = Math.ceil(totalCount / rowsPerPage)

    useEffect(() => {
        fetchThreads()
    }, [statusFilter, currentPage, rowsPerPage])

    const fetchThreads = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'all') params.append('status', statusFilter)
            if (searchQuery) params.append('q', searchQuery)
            params.append('page', currentPage.toString())
            params.append('limit', rowsPerPage.toString())
            
            const res = await fetch(`/api/admin/support/threads?${params.toString()}`)
            const data = await res.json()
            if (data.threads) {
                setThreads(data.threads)
                setTotalCount(data.total || data.threads.length)
            }
        } catch (error) {
            console.error('Failed to fetch threads', error)
        } finally {
            setLoading(false)
        }
    }

    const handleThreadClick = (thread: Thread) => {
        console.log('Thread clicked:', thread.id, thread.subject)
        setActiveThread(thread)
        setView('detail')
    }
    
    const handleSearch = () => {
        setCurrentPage(1) // Reset to first page when searching
        fetchThreads()
    }

    return (
        <div className="h-[600px] min-h-[400px] flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden">
            {view === 'list' ? (
                <div className="flex flex-col h-full">
                    {/* Toolbar */}
                    <div className="p-4 border-b flex items-center justify-between gap-4 bg-gray-50/50">
                        <div className="flex items-center gap-2 flex-1">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input 
                                    placeholder="Search subjects, user name, or phone..." 
                                    className="pl-9 bg-white"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                                <SelectTrigger className="w-[150px] bg-white">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="open">Open</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="resolved">Resolved</SelectItem>
                                    <SelectItem value="closed">Closed</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button variant="outline" size="icon" onClick={fetchThreads}>
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        </div>
                        <Button onClick={() => setShowBlastModal(true)} className="bg-purple-600 hover:bg-purple-700 text-white">
                            <Megaphone className="w-4 h-4 mr-2" />
                            Blast Announcement
                        </Button>
                    </div>

                    {/* List */}
                    <ScrollArea className="flex-1">
                        <div className="divide-y">
                            {loading ? (
                                <div className="p-8 text-center text-gray-500">Loading threads...</div>
                            ) : threads.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No threads found.</div>
                            ) : (
                                threads.map((thread, index) => (
                                    <div 
                                        key={thread.id}
                                        onClick={() => handleThreadClick(thread)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => e.key === 'Enter' && handleThreadClick(thread)}
                                        className={cn(
                                            "p-4 hover:bg-blue-50 cursor-pointer transition-all border-b last:border-b-0",
                                            thread.is_unread ? "bg-blue-50/50" : "bg-white"
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            {/* Sequence Number */}
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
                                                {(currentPage - 1) * rowsPerPage + index + 1}
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className={cn("text-sm font-medium truncate", thread.is_unread ? "text-gray-900 font-bold" : "text-gray-700")}>
                                                            {thread.subject}
                                                        </h4>
                                                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                                            {thread.case_id || `#${thread.id.slice(0, 6)}`}
                                                        </span>
                                                        {thread.is_unread && <Badge className="h-1.5 w-1.5 rounded-full p-0 bg-blue-600" />}
                                                    </div>
                                                    <span className="text-xs text-gray-400 whitespace-nowrap">
                                                        {format(new Date(thread.last_message_at), 'MMM d, HH:mm')}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-500 truncate mb-2">
                                                    {thread.last_message_preview || 'No messages'}
                                                </p>
                                                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                                                    <span className="flex items-center gap-1">
                                                        <User className="w-3 h-3" />
                                                        {thread.created_by?.full_name || thread.created_by?.email || 'Unknown User'}
                                                    </span>
                                                    {thread.created_by?.phone && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-blue-600">{thread.created_by.phone}</span>
                                                        </>
                                                    )}
                                                    <span>•</span>
                                                    <StatusBadge status={thread.status} />
                                                    {thread.assigned_to && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Assigned to: {thread.assigned_to.full_name}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                    
                    {/* Pagination Controls */}
                    {!loading && threads.length > 0 && (
                        <div className="p-3 border-t bg-gray-50/50 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <span>Rows per page:</span>
                                <Select value={rowsPerPage.toString()} onValueChange={(v) => { setRowsPerPage(parseInt(v)); setCurrentPage(1); }}>
                                    <SelectTrigger className="w-[70px] h-8 bg-white">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                        <SelectItem value="100">100</SelectItem>
                                    </SelectContent>
                                </Select>
                                <span className="text-gray-400">|</span>
                                <span>{(currentPage - 1) * rowsPerPage + 1}-{Math.min(currentPage * rowsPerPage, totalCount)} of {totalCount}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => setCurrentPage(1)}
                                    disabled={currentPage === 1}
                                    className="h-8 px-2"
                                >
                                    First
                                </Button>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="h-8 px-2"
                                >
                                    Prev
                                </Button>
                                <span className="px-3 text-sm text-gray-600">
                                    Page {currentPage} of {totalPages || 1}
                                </span>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage >= totalPages}
                                    className="h-8 px-2"
                                >
                                    Next
                                </Button>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={currentPage >= totalPages}
                                    className="h-8 px-2"
                                >
                                    Last
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <AdminChatThreadView 
                    thread={activeThread!} 
                    onBack={() => {
                        setView('list')
                        fetchThreads()
                    }}
                />
            )}

            <BlastModal open={showBlastModal} onOpenChange={setShowBlastModal} />
        </div>
    )
}

function AdminChatThreadView({ thread, onBack }: { thread: Thread, onBack: () => void }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [status, setStatus] = useState(thread.status)

    useEffect(() => {
        fetchMessages()
    }, [thread.id])

    const fetchMessages = async () => {
        try {
            const res = await fetch(`/api/support/threads/${thread.id}/messages?limit=50`)
            const data = await res.json()
            if (data.messages) {
                setMessages(data.messages.reverse())
                setTimeout(scrollToBottom, 100)
            }
        } catch (error) {
            console.error('Failed to fetch messages', error)
        }
    }

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault()
        e.stopPropagation()
        
        const messageToSend = newMessage.trim()
        if (!messageToSend) {
            console.log('No message to send')
            return
        }

        console.log('Sending admin reply:', { threadId: thread.id, message: messageToSend })
        setError(null)
        setSending(true)
        
        try {
            const res = await fetch(`/api/admin/support/threads/${thread.id}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageToSend })
            })
            
            console.log('Response status:', res.status)
            const data = await res.json()
            console.log('Response data:', data)
            
            if (!res.ok) {
                const errorMsg = data.details 
                    ? `${data.error}: ${data.details} (${data.code || res.status})`
                    : data.error || `Failed to send reply (${res.status})`
                setError(errorMsg)
                console.error('Failed to send reply:', data)
                return
            }
            
            if (data.message) {
                setMessages(prev => [...prev, data.message])
                setNewMessage('')
                setStatus('pending') // Auto update status locally
                setTimeout(scrollToBottom, 100)
            } else {
                setError('No message returned from server')
                console.error('Failed to send reply, no message returned', data)
            }
        } catch (error: any) {
            console.error('Failed to send reply:', error)
            setError(`Network error: ${error.message || 'please try again'}`)
        } finally {
            setSending(false)
        }
    }

    const updateStatus = async (newStatus: string) => {
        try {
            await fetch(`/api/admin/support/threads/${thread.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            })
            setStatus(newStatus as any)
        } catch (error) {
            console.error('Failed to update status', error)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">{thread.subject}</h3>
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                                {thread.case_id || `#${thread.id.slice(0, 6)}`}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500">
                            {thread.created_by?.full_name} ({thread.created_by?.email}) • {thread.created_by?.phone}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={status} onValueChange={updateStatus}>
                        <SelectTrigger className="w-[130px] h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-red-50 border-b border-red-100 px-4 py-2 text-sm text-red-600 flex items-center justify-between">
                    <span>{error}</span>
                    <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 text-red-600 hover:text-red-800">
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Chat Area */}
            <ScrollArea className="flex-1 p-4 bg-gray-50/30">
                <div className="space-y-4 pb-4">
                    {messages.map((msg) => {
                        const isAdmin = msg.sender_type === 'admin'
                        const isSystem = msg.sender_type === 'system'
                        
                        if (isSystem) {
                            return (
                                <div key={msg.id} className="flex justify-center my-4">
                                    <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full">
                                        {msg.body}
                                    </span>
                                </div>
                            )
                        }

                        return (
                            <div key={msg.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                    "max-w-[80%] rounded-2xl px-4 py-2 shadow-sm",
                                    isAdmin ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-900 border border-gray-100 rounded-bl-none"
                                )}>
                                    <p className="whitespace-pre-wrap text-sm">{msg.body}</p>
                                    <div className={cn("text-[10px] mt-1 flex items-center justify-end gap-1", isAdmin ? "text-blue-100" : "text-gray-400")}>
                                        {format(new Date(msg.created_at), 'HH:mm')}
                                        {isAdmin && <span className="text-[10px] opacity-70 ml-1">(Admin)</span>}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            {/* Composer */}
            <div className="p-4 bg-white border-t">
                <form onSubmit={handleSend} className="flex items-end gap-2">
                    <Textarea 
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a reply..."
                        className="min-h-[80px] resize-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend(e)
                            }
                        }}
                    />
                    <Button type="submit" className="h-[80px] w-[80px]" disabled={sending || !newMessage.trim()}>
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                </form>
            </div>
        </div>
    )
}

function BlastModal({ open, onOpenChange }: any) {
    const [message, setMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [targetType, setTargetType] = useState<'all' | 'state' | 'role'>('all')
    const [selectedStates, setSelectedStates] = useState<string[]>([])
    const [selectedRoles, setSelectedRoles] = useState<string[]>([])
    const [states, setStates] = useState<{ id: string, state_name: string, state_code: string }[]>([])
    const [loadingStates, setLoadingStates] = useState(false)
    const [previewCount, setPreviewCount] = useState<number | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)
    
    // Progress tracking state
    const [progress, setProgress] = useState<{
        status: 'idle' | 'sending' | 'complete' | 'error'
        total: number
        sent: number
        failed: number
        percent: number
        message: string
        errors?: string[]
    }>({
        status: 'idle',
        total: 0,
        sent: 0,
        failed: 0,
        percent: 0,
        message: ''
    })

    // User role options
    const roleOptions = [
        { value: 'consumer', label: 'Consumers' },
        { value: 'shop', label: 'Shop Owners' },
        { value: 'SA', label: 'Sales Agents' },
        { value: 'HQ', label: 'HQ Staff' }
    ]

    // Fetch states on mount
    useEffect(() => {
        if (open) {
            fetchStates()
        }
    }, [open])

    // Update preview count when filters change
    useEffect(() => {
        if (open && message.trim()) {
            fetchPreviewCount()
        } else {
            setPreviewCount(null)
        }
    }, [targetType, selectedStates, selectedRoles, open])

    const fetchStates = async () => {
        setLoadingStates(true)
        try {
            const res = await fetch('/api/admin/states')
            const data = await res.json()
            if (data.states) {
                setStates(data.states)
            }
        } catch (error) {
            console.error('Failed to fetch states:', error)
        } finally {
            setLoadingStates(false)
        }
    }

    const fetchPreviewCount = async () => {
        setLoadingPreview(true)
        try {
            const params = new URLSearchParams()
            params.append('targetType', targetType)
            if (targetType === 'state' && selectedStates.length > 0) {
                params.append('states', selectedStates.join(','))
            }
            if (targetType === 'role' && selectedRoles.length > 0) {
                params.append('roles', selectedRoles.join(','))
            }
            
            const res = await fetch(`/api/admin/support/blast/preview?${params.toString()}`)
            const data = await res.json()
            setPreviewCount(data.count || 0)
        } catch (error) {
            console.error('Failed to get preview count:', error)
            setPreviewCount(null)
        } finally {
            setLoadingPreview(false)
        }
    }

    const handleSend = async () => {
        if (!message.trim()) return
        
        const targetDescription = targetType === 'all' 
            ? 'ALL users' 
            : targetType === 'state' 
                ? `users in ${selectedStates.length} state(s)` 
                : `users with ${selectedRoles.length} role(s)`
        
        if (!confirm(`Are you sure you want to send this announcement to ${targetDescription}?`)) return

        setSending(true)
        setProgress({
            status: 'sending',
            total: 0,
            sent: 0,
            failed: 0,
            percent: 0,
            message: 'Starting...'
        })
        
        try {
            const res = await fetch('/api/admin/support/blast/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message, 
                    subject: 'Announcement',
                    targetType,
                    states: targetType === 'state' ? selectedStates : [],
                    roles: targetType === 'role' ? selectedRoles : []
                })
            })
            
            if (!res.body) {
                throw new Error('No response body')
            }
            
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                
                const chunk = decoder.decode(value)
                const lines = chunk.split('\n')
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6))
                            
                            if (data.type === 'start') {
                                setProgress(prev => ({
                                    ...prev,
                                    total: data.total,
                                    message: data.message
                                }))
                            } else if (data.type === 'progress') {
                                setProgress(prev => ({
                                    ...prev,
                                    sent: data.sent,
                                    failed: data.failed,
                                    percent: data.progress,
                                    message: data.message
                                }))
                            } else if (data.type === 'complete') {
                                setProgress({
                                    status: 'complete',
                                    total: data.total,
                                    sent: data.sent,
                                    failed: data.failed,
                                    percent: 100,
                                    message: data.message,
                                    errors: data.errors
                                })
                            } else if (data.type === 'error') {
                                setProgress(prev => ({
                                    ...prev,
                                    status: 'error',
                                    message: data.error
                                }))
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to send blast', error)
            setProgress(prev => ({
                ...prev,
                status: 'error',
                message: 'Network error - please try again'
            }))
        } finally {
            setSending(false)
        }
    }
    
    const handleClose = () => {
        if (!sending) {
            onOpenChange(false)
            setMessage('')
            setTargetType('all')
            setSelectedStates([])
            setSelectedRoles([])
            setProgress({
                status: 'idle',
                total: 0,
                sent: 0,
                failed: 0,
                percent: 0,
                message: ''
            })
        }
    }

    const toggleState = (stateCode: string) => {
        setSelectedStates(prev => 
            prev.includes(stateCode) 
                ? prev.filter(s => s !== stateCode) 
                : [...prev, stateCode]
        )
    }

    const toggleRole = (role: string) => {
        setSelectedRoles(prev => 
            prev.includes(role) 
                ? prev.filter(r => r !== role) 
                : [...prev, role]
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Send Announcement Blast</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {/* Target Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Send To</label>
                        <Select value={targetType} onValueChange={(v: any) => setTargetType(v)}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Users</SelectItem>
                                <SelectItem value="state">Filter by State/Location</SelectItem>
                                <SelectItem value="role">Filter by User Type</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* State Filter */}
                    {targetType === 'state' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select States {selectedStates.length > 0 && `(${selectedStates.length} selected)`}
                            </label>
                            {loadingStates ? (
                                <div className="text-sm text-gray-500">Loading states...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto p-2 bg-gray-50 rounded-lg">
                                    {states.map(state => (
                                        <label 
                                            key={state.state_code} 
                                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-1 rounded"
                                        >
                                            <input 
                                                type="checkbox" 
                                                checked={selectedStates.includes(state.state_code)}
                                                onChange={() => toggleState(state.state_code)}
                                                className="rounded border-gray-300"
                                            />
                                            {state.state_name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Role Filter */}
                    {targetType === 'role' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select User Types {selectedRoles.length > 0 && `(${selectedRoles.length} selected)`}
                            </label>
                            <div className="grid grid-cols-2 gap-2 p-2 bg-gray-50 rounded-lg">
                                {roleOptions.map(role => (
                                    <label 
                                        key={role.value} 
                                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-2 rounded"
                                    >
                                        <input 
                                            type="checkbox" 
                                            checked={selectedRoles.includes(role.value)}
                                            onChange={() => toggleRole(role.value)}
                                            className="rounded border-gray-300"
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Preview Count */}
                    {previewCount !== null && (
                        <div className="bg-blue-50 p-3 rounded-md border border-blue-200 text-sm text-blue-800">
                            {loadingPreview ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Calculating recipients...
                                </span>
                            ) : (
                                <span>This message will be sent to approximately <strong>{previewCount}</strong> user(s)</span>
                            )}
                        </div>
                    )}

                    <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 text-sm text-yellow-800 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <p>
                            {targetType === 'all' 
                                ? 'This message will be sent to ALL active users as a new thread or update to their "Announcements" thread.'
                                : 'This message will be sent to users matching the selected filters.'}
                        </p>
                    </div>
                    
                    <Textarea 
                        placeholder="Type your announcement here..." 
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="min-h-[150px]"
                        disabled={sending}
                    />
                    
                    {/* Progress Display */}
                    {progress.status !== 'idle' && (
                        <div className={cn(
                            "p-4 rounded-lg border",
                            progress.status === 'complete' && "bg-green-50 border-green-200",
                            progress.status === 'error' && "bg-red-50 border-red-200",
                            progress.status === 'sending' && "bg-blue-50 border-blue-200"
                        )}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">
                                    {progress.status === 'complete' ? '✅ Complete' : 
                                     progress.status === 'error' ? '❌ Error' : 
                                     '📤 Sending...'}
                                </span>
                                {progress.total > 0 && (
                                    <span className="text-sm text-gray-600">
                                        {progress.sent}/{progress.total} sent
                                        {progress.failed > 0 && <span className="text-red-600 ml-2">({progress.failed} failed)</span>}
                                    </span>
                                )}
                            </div>
                            
                            {/* Progress Bar */}
                            {progress.status === 'sending' && progress.total > 0 && (
                                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                    <div 
                                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${progress.percent}%` }}
                                    />
                                </div>
                            )}
                            
                            <p className="text-sm text-gray-700">{progress.message}</p>
                            
                            {progress.errors && progress.errors.length > 0 && (
                                <details className="mt-2">
                                    <summary className="text-xs text-red-600 cursor-pointer">View errors ({progress.errors.length})</summary>
                                    <ul className="mt-1 text-xs text-red-500 list-disc list-inside">
                                        {progress.errors.map((err, i) => <li key={i}>{err}</li>)}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={sending}>
                        {progress.status === 'complete' ? 'Close' : 'Cancel'}
                    </Button>
                    {progress.status !== 'complete' && (
                        <Button 
                            onClick={handleSend} 
                            disabled={sending || !message.trim() || (targetType === 'state' && selectedStates.length === 0) || (targetType === 'role' && selectedRoles.length === 0)} 
                            className="bg-purple-600 hover:bg-purple-700"
                        >
                            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Megaphone className="w-4 h-4 mr-2" />}
                            {sending ? 'Sending...' : 'Send Blast'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function StatusBadge({ status }: { status: string }) {
    const styles: any = {
        open: "bg-green-100 text-green-700 border-green-200",
        pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
        resolved: "bg-blue-100 text-blue-700 border-blue-200",
        closed: "bg-gray-100 text-gray-700 border-gray-200"
    }
    return (
        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border uppercase tracking-wider", styles[status] || styles.closed)}>
            {status}
        </span>
    )
}
