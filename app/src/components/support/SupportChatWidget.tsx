'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
    MessageSquare, 
    Plus, 
    ArrowLeft, 
    Send, 
    Image as ImageIcon, 
    Trash2, 
    MoreVertical,
    Check,
    CheckCheck,
    Loader2,
    X
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import Image from 'next/image'

type Thread = {
    id: string
    subject: string
    status: 'open' | 'pending' | 'resolved' | 'closed'
    last_message_preview: string
    last_message_at: string
    unread_count: number
    created_at: string
}

type Message = {
    id: string
    sender_type: 'user' | 'admin' | 'system'
    body: string
    attachments: any[]
    created_at: string
    is_deleted_by_user: boolean
}

export function SupportChatWidget({ onClose }: { onClose: () => void }) {
    const [view, setView] = useState<'inbox' | 'new-chat' | 'thread'>('inbox')
    const [threads, setThreads] = useState<Thread[]>([])
    const [activeThread, setActiveThread] = useState<Thread | null>(null)
    const [loading, setLoading] = useState(false)
    
    // Fetch threads on mount
    useEffect(() => {
        fetchThreads()
    }, [])

    const fetchThreads = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/support/threads')
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
        setView('thread')
    }

    const handleBack = () => {
        if (view === 'thread') {
            setActiveThread(null)
            setView('inbox')
            fetchThreads() // Refresh to update unread counts/last message
        } else if (view === 'new-chat') {
            setView('inbox')
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-white border-b shadow-sm sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    {view !== 'inbox' && (
                        <Button variant="ghost" size="icon" onClick={handleBack} className="-ml-2">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    )}
                    <h2 className="text-lg font-semibold text-gray-900">
                        {view === 'inbox' ? 'Support Inbox' : 
                         view === 'new-chat' ? 'New Conversation' : 
                         activeThread?.subject || 'Chat'}
                    </h2>
                </div>
                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onClose()
                    }}
                >
                    <X className="w-5 h-5" />
                </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {view === 'inbox' && (
                    <InboxView 
                        threads={threads} 
                        loading={loading} 
                        onThreadClick={handleThreadClick} 
                        onNewChat={() => setView('new-chat')}
                        onDeleteThread={async (id: string) => {
                            if (confirm('Delete this conversation?')) {
                                await fetch(`/api/support/threads/${id}`, { method: 'DELETE' })
                                fetchThreads()
                            }
                        }}
                    />
                )}
                {view === 'new-chat' && (
                    <NewChatView 
                        onCancel={() => setView('inbox')}
                        onSuccess={(threadId: string) => {
                            fetchThreads().then(() => {
                                // Find the new thread and open it
                                // For now just go back to inbox then user clicks it, or we can try to find it
                                setView('inbox')
                            })
                        }}
                    />
                )}
                {view === 'thread' && activeThread && (
                    <ChatThreadView 
                        thread={activeThread} 
                    />
                )}
            </div>
        </div>
    )
}

function InboxView({ threads, loading, onThreadClick, onNewChat, onDeleteThread }: any) {
    if (loading && threads.length === 0) {
        return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
    }

    return (
        <div className="h-full flex flex-col">
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                    {threads.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>No messages yet.</p>
                            <p className="text-sm">Start a new conversation to get help.</p>
                        </div>
                    ) : (
                        threads.map((thread: Thread) => (
                            <div 
                                key={thread.id}
                                onClick={() => onThreadClick(thread)}
                                onContextMenu={(e) => {
                                    e.preventDefault()
                                    onDeleteThread(thread.id)
                                }}
                                className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer relative overflow-hidden"
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <h3 className="font-semibold text-gray-900 truncate pr-4">{thread.subject}</h3>
                                    <span className="text-xs text-gray-400 whitespace-nowrap">
                                        {format(new Date(thread.last_message_at), 'MMM d, HH:mm')}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className={cn("text-sm truncate flex-1 pr-4", thread.unread_count > 0 ? "text-gray-900 font-medium" : "text-gray-500")}>
                                        {thread.last_message_preview || 'No messages'}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {thread.unread_count > 0 && (
                                            <Badge variant="destructive" className="rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center">
                                                {thread.unread_count}
                                            </Badge>
                                        )}
                                        <StatusBadge status={thread.status} />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
            <div className="p-4 sticky bottom-0 bg-gradient-to-t from-gray-50 to-transparent pt-8">
                <Button onClick={onNewChat} className="w-full shadow-lg rounded-full h-12 text-base font-medium">
                    <Plus className="w-5 h-5 mr-2" /> Start New Conversation
                </Button>
            </div>
        </div>
    )
}

function NewChatView({ onCancel, onSuccess }: any) {
    const [subject, setSubject] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [attachments, setAttachments] = useState<any[]>([])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!subject.trim() || !message.trim()) return

        setLoading(true)
        try {
            const res = await fetch('/api/support/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject, message, attachments })
            })
            const data = await res.json()
            if (data.threadId) {
                onSuccess(data.threadId)
            }
        } catch (error) {
            console.error('Failed to create thread', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="p-4 h-full flex flex-col bg-white">
            <form onSubmit={handleSubmit} className="space-y-4 flex-1">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <Input 
                        value={subject} 
                        onChange={(e) => setSubject(e.target.value)} 
                        placeholder="What is this about?"
                        required
                        className="bg-gray-50"
                    />
                </div>
                <div className="flex-1 flex flex-col">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                    <Textarea 
                        value={message} 
                        onChange={(e) => setMessage(e.target.value)} 
                        placeholder="Describe your issue..."
                        required
                        className="flex-1 bg-gray-50 resize-none min-h-[200px]"
                    />
                </div>
                
                {/* Simple Image Upload Placeholder */}
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => alert('Image upload implementation requires Supabase Storage setup on client')}>
                        <ImageIcon className="w-4 h-4 mr-2" /> Attach Image
                    </Button>
                    <span className="text-xs text-gray-400">Optional</span>
                </div>

                <Button type="submit" className="w-full h-12" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Send Message
                </Button>
            </form>
        </div>
    )
}

function ChatThreadView({ thread }: { thread: Thread }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [sending, setSending] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [polling, setPolling] = useState(0)

    // Fetch messages
    useEffect(() => {
        fetchMessages()
        // Mark as read
        fetch(`/api/support/threads/${thread.id}/read`, { method: 'POST' })
        
        // Poll every 5 seconds
        const interval = setInterval(() => {
            setPolling(p => p + 1)
        }, 5000)
        return () => clearInterval(interval)
    }, [thread.id])

    // Re-fetch on poll
    useEffect(() => {
        if (polling > 0) fetchMessages(true)
    }, [polling])

    const fetchMessages = async (silent = false) => {
        try {
            const res = await fetch(`/api/support/threads/${thread.id}/messages?limit=50`)
            const data = await res.json()
            if (data.messages) {
                // Check if we have new messages to scroll down
                const isNew = data.messages.length > messages.length
                setMessages(data.messages.reverse()) // API returns newest first, we want oldest first for display usually, or reverse list
                if (isNew && !silent) {
                    setTimeout(scrollToBottom, 100)
                }
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
            const res = await fetch(`/api/support/threads/${thread.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: newMessage })
            })
            const data = await res.json()
            if (data.message) {
                setMessages([...messages, data.message])
                setNewMessage('')
                setTimeout(scrollToBottom, 100)
            }
        } catch (error) {
            console.error('Failed to send message', error)
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="bg-white border-b px-4 py-2 flex justify-between items-center text-xs text-gray-500">
                <span>Status: <StatusBadge status={thread.status} /></span>
                <span>ID: {thread.id.slice(0, 8)}</span>
            </div>
            
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4 pb-4">
                    {messages.map((msg) => {
                        const isMe = msg.sender_type === 'user'
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
                            <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                    "max-w-[80%] rounded-2xl px-4 py-2 shadow-sm",
                                    isMe ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-900 border border-gray-100 rounded-bl-none"
                                )}>
                                    <p className="whitespace-pre-wrap text-sm">{msg.body}</p>
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-2 space-y-2">
                                            {msg.attachments.map((att: any, i: number) => (
                                                <div key={i} className="relative rounded-lg overflow-hidden">
                                                    {/* Placeholder for image rendering */}
                                                    <div className="bg-gray-200 h-32 w-full flex items-center justify-center text-xs text-gray-500">
                                                        Image Attachment
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className={cn("text-[10px] mt-1 flex items-center justify-end gap-1", isMe ? "text-blue-100" : "text-gray-400")}>
                                        {format(new Date(msg.created_at), 'HH:mm')}
                                        {isMe && <CheckCheck className="w-3 h-3" />}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            <div className="p-3 bg-white border-t">
                <form onSubmit={handleSend} className="flex items-end gap-2">
                    <Button type="button" variant="ghost" size="icon" className="text-gray-400 shrink-0">
                        <ImageIcon className="w-5 h-5" />
                    </Button>
                    <Textarea 
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="min-h-[44px] max-h-[120px] py-3 resize-none bg-gray-50 border-0 focus-visible:ring-1"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend(e)
                            }
                        }}
                    />
                    <Button type="submit" size="icon" disabled={sending || !newMessage.trim()} className="shrink-0 bg-blue-600 hover:bg-blue-700">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                </form>
            </div>
        </div>
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
