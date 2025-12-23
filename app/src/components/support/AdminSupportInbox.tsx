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
    ArrowLeft
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"

type Thread = {
    id: string
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

    useEffect(() => {
        fetchThreads()
    }, [statusFilter])

    const fetchThreads = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'all') params.append('status', statusFilter)
            if (searchQuery) params.append('q', searchQuery)
            
            const res = await fetch(`/api/admin/support/threads?${params.toString()}`)
            const data = await res.json()
            if (data.threads) {
                setThreads(data.threads)
            }
        } catch (error) {
            console.error('Failed to fetch threads', error)
        } finally {
            setLoading(false)
        }
    }

    const handleThreadClick = (thread: Thread) => {
        setActiveThread(thread)
        setView('detail')
    }

    return (
        <div className="h-[calc(100vh-200px)] flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden">
            {view === 'list' ? (
                <div className="flex flex-col h-full">
                    {/* Toolbar */}
                    <div className="p-4 border-b flex items-center justify-between gap-4 bg-gray-50/50">
                        <div className="flex items-center gap-2 flex-1">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input 
                                    placeholder="Search subjects..." 
                                    className="pl-9 bg-white"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && fetchThreads()}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                                threads.map((thread) => (
                                    <div 
                                        key={thread.id}
                                        onClick={() => handleThreadClick(thread)}
                                        className={cn(
                                            "p-4 hover:bg-gray-50 cursor-pointer transition-colors flex items-start gap-4",
                                            thread.is_unread ? "bg-blue-50/50" : ""
                                        )}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <h4 className={cn("text-sm font-medium truncate", thread.is_unread ? "text-gray-900 font-bold" : "text-gray-700")}>
                                                        {thread.subject}
                                                    </h4>
                                                    {thread.is_unread && <Badge className="h-1.5 w-1.5 rounded-full p-0 bg-blue-600" />}
                                                </div>
                                                <span className="text-xs text-gray-400 whitespace-nowrap">
                                                    {format(new Date(thread.last_message_at), 'MMM d, HH:mm')}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-500 truncate mb-2">
                                                {thread.last_message_preview || 'No messages'}
                                            </p>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <User className="w-3 h-3" />
                                                    {thread.created_by?.full_name || thread.created_by?.email || 'Unknown User'}
                                                </span>
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
                                ))
                            )}
                        </div>
                    </ScrollArea>
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
        if (!newMessage.trim()) return

        setSending(true)
        try {
            const res = await fetch(`/api/admin/support/threads/${thread.id}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: newMessage })
            })
            const data = await res.json()
            if (data.message) {
                setMessages([...messages, data.message])
                setNewMessage('')
                setStatus('pending') // Auto update status locally
                setTimeout(scrollToBottom, 100)
            }
        } catch (error) {
            console.error('Failed to send reply', error)
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
                        <h3 className="font-semibold text-gray-900">{thread.subject}</h3>
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

    const handleSend = async () => {
        if (!message.trim()) return
        if (!confirm('Are you sure you want to send this announcement to ALL users?')) return

        setSending(true)
        try {
            await fetch('/api/admin/support/blast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, subject: 'Announcement' })
            })
            onOpenChange(false)
            setMessage('')
            alert('Announcement sent successfully')
        } catch (error) {
            console.error('Failed to send blast', error)
            alert('Failed to send announcement')
        } finally {
            setSending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send Announcement Blast</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 text-sm text-yellow-800 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <p>This message will be sent to ALL active users as a new thread or update to their "Announcements" thread.</p>
                    </div>
                    <Textarea 
                        placeholder="Type your announcement here..." 
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="min-h-[150px]"
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSend} disabled={sending || !message.trim()} className="bg-purple-600 hover:bg-purple-700">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Megaphone className="w-4 h-4 mr-2" />}
                        Send Blast
                    </Button>
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
