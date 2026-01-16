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
    case_id: string
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
            <div className="flex items-center justify-between p-4 bg-white border-b shadow-sm sticky top-0 z-10 w-full">
                <div className="flex items-center gap-2">
                    {view === 'inbox' ? (
                        <Button variant="ghost" size="icon" onClick={() => onClose()} className="-ml-2">
                             <ArrowLeft className="w-5 h-5" />
                        </Button>
                    ) : (
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
                            try {
                                const res = await fetch(`/api/support/threads/${id}`, { method: 'DELETE' })
                                const data = await res.json()
                                if (res.ok && data.success) {
                                    // Refresh the list
                                    fetchThreads()
                                } else {
                                    console.error('Delete failed:', data)
                                    alert('Failed to delete conversation')
                                }
                            } catch (error) {
                                console.error('Delete error:', error)
                                alert('Failed to delete conversation')
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
                        onRefresh={() => fetchThreads()}
                    />
                )}
            </div>
        </div>
    )
}

function InboxView({ threads, loading, onThreadClick, onNewChat, onDeleteThread }: any) {
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)
    
    if (loading && threads.length === 0) {
        return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
    }

    const handleDelete = (e: React.MouseEvent, threadId: string) => {
        e.stopPropagation()
        setDeleteConfirm(threadId)
    }

    const confirmDelete = async (threadId: string) => {
        setDeleting(true)
        try {
            await onDeleteThread(threadId)
        } finally {
            setDeleting(false)
            setDeleteConfirm(null)
        }
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
                                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
                            >
                                {deleteConfirm === thread.id ? (
                                    <div className="p-4 bg-red-50 flex items-center justify-between">
                                        <span className="text-sm text-red-700">Delete this conversation?</span>
                                        <div className="flex gap-2">
                                            <Button 
                                                size="sm" 
                                                variant="outline" 
                                                onClick={() => setDeleteConfirm(null)}
                                                disabled={deleting}
                                            >
                                                Cancel
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="destructive" 
                                                onClick={() => confirmDelete(thread.id)}
                                                disabled={deleting}
                                            >
                                                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div 
                                        onClick={() => onThreadClick(thread)}
                                        className="p-4 active:scale-[0.98] transition-transform cursor-pointer relative"
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <h3 className="font-semibold text-gray-900 truncate">{thread.subject}</h3>
                                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                                    {thread.case_id || `#${thread.id.slice(0, 6)}`}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 ml-2">
                                                <span className="text-xs text-gray-400 whitespace-nowrap">
                                                    {format(new Date(thread.last_message_at), 'MMM d, HH:mm')}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-gray-400 hover:text-red-500"
                                                    onClick={(e) => handleDelete(e, thread.id)}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
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
                                                {/* Status removed as per request */}
                                            </div>
                                        </div>
                                    </div>
                                )}
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
    const supabase = createClient()
    const [subject, setSubject] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [attachments, setAttachments] = useState<any[]>([])
    const [uploading, setUploading] = useState(false)
    const [compressionInfo, setCompressionInfo] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Image compression function
    const compressImage = async (file: File, maxWidth: number = 1200, quality: number = 0.8): Promise<{ blob: Blob, originalSize: number, compressedSize: number }> => {
        return new Promise((resolve, reject) => {
            const originalSize = file.size
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = (event) => {
                const img = document.createElement('img')
                img.src = event.target?.result as string
                img.onload = () => {
                    const canvas = document.createElement('canvas')
                    let width = img.width
                    let height = img.height
                    
                    // Scale down if larger than maxWidth
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width)
                        width = maxWidth
                    }
                    
                    canvas.width = width
                    canvas.height = height
                    
                    const ctx = canvas.getContext('2d')
                    if (!ctx) {
                        reject(new Error('Could not get canvas context'))
                        return
                    }
                    
                    ctx.drawImage(img, 0, 0, width, height)
                    
                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve({ blob, originalSize, compressedSize: blob.size })
                            } else {
                                reject(new Error('Failed to compress image'))
                            }
                        },
                        'image/jpeg',
                        quality
                    )
                }
                img.onerror = () => reject(new Error('Failed to load image'))
            }
            reader.onerror = () => reject(new Error('Failed to read file'))
        })
    }

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file')
            return
        }

        // Validate file size (max 10MB for original, will be compressed)
        if (file.size > 10 * 1024 * 1024) {
            alert('Image must be less than 10MB')
            return
        }

        setUploading(true)
        setCompressionInfo(null)
        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                alert('Please login to upload images')
                return
            }

            // Compress image
            let fileToUpload: Blob | File = file
            let compressionMsg = ''
            
            if (file.size > 500 * 1024) { // Compress if larger than 500KB
                try {
                    const { blob, originalSize, compressedSize } = await compressImage(file)
                    fileToUpload = blob
                    const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(0)
                    compressionMsg = `Optimized: ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)} (${savings}% smaller)`
                    setCompressionInfo(compressionMsg)
                } catch (compressError) {
                    console.error('Compression failed, using original:', compressError)
                    compressionMsg = `Original: ${formatFileSize(file.size)}`
                    setCompressionInfo(compressionMsg)
                }
            } else {
                compressionMsg = `Size: ${formatFileSize(file.size)}`
                setCompressionInfo(compressionMsg)
            }

            // Create unique filename
            const fileExt = file.type === 'image/png' ? 'png' : 'jpg'
            const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

            // Upload to Supabase Storage
            const { data, error } = await supabase.storage
                .from('support-attachments')
                .upload(fileName, fileToUpload, {
                    contentType: 'image/jpeg'
                })

            if (error) {
                console.error('Upload error:', error)
                alert('Failed to upload image: ' + error.message)
                return
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('support-attachments')
                .getPublicUrl(fileName)

            // Create local preview URL for immediate display
            const localPreviewUrl = URL.createObjectURL(fileToUpload)

            // Add to attachments
            setAttachments([...attachments, { 
                url: publicUrl,
                previewUrl: localPreviewUrl,
                name: file.name, 
                type: 'image/jpeg',
                path: fileName,
                size: fileToUpload.size,
                compressionInfo: compressionMsg
            }])
        } catch (error: any) {
            console.error('Upload failed:', error)
            alert('Failed to upload image')
        } finally {
            setUploading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    const removeAttachment = (index: number) => {
        const att = attachments[index]
        if (att.previewUrl) {
            URL.revokeObjectURL(att.previewUrl)
        }
        setAttachments(attachments.filter((_, i) => i !== index))
        setCompressionInfo(null)
    }

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
                
                {/* Image Upload */}
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                    />
                    <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                    >
                        {uploading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <ImageIcon className="w-4 h-4 mr-2" />
                        )}
                        {uploading ? 'Uploading...' : 'Attach Image'}
                    </Button>
                    <span className="text-xs text-gray-400">Optional (max 5MB)</span>
                </div>

                {/* Attachment Preview */}
                {attachments.length > 0 && (
                    <div className="space-y-2">
                        {attachments.map((att, idx) => (
                            <div key={idx} className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg border">
                                <div className="relative shrink-0">
                                    <img 
                                        src={att.previewUrl || att.url} 
                                        alt={att.name} 
                                        className="w-20 h-20 object-cover rounded-lg border"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(idx)}
                                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-700 truncate">{att.name}</p>
                                    <p className="text-xs text-green-600 mt-1">{att.compressionInfo}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Button type="submit" className="w-full h-12" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Send Message
                </Button>
            </form>
        </div>
    )
}

function ChatThreadView({ thread, onRefresh }: { thread: Thread, onRefresh?: () => void }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
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
            console.log('[User Chat] Fetching messages for thread:', thread.id)
            const res = await fetch(`/api/support/threads/${thread.id}/messages?limit=50`)
            const data = await res.json()
            console.log('[User Chat] Messages response:', data)
            
            if (!res.ok) {
                console.error('[User Chat] Failed to fetch messages:', data)
                setError(data.error || 'Failed to load messages')
                return
            }
            
            if (data.messages) {
                console.log('[User Chat] Received messages count:', data.messages.length)
                // Check if we have new messages to scroll down
                const isNew = data.messages.length > messages.length
                // Filter out deleted messages and reverse for chronological order
                const validMessages = data.messages.filter((m: Message) => !m.is_deleted_by_user)
                console.log('[User Chat] Valid messages after filter:', validMessages.length)
                setMessages(validMessages.reverse()) // API returns newest first, we want oldest first for display
                if (isNew && !silent) {
                    setTimeout(scrollToBottom, 100)
                }
            } else {
                console.warn('[User Chat] No messages array in response')
            }
        } catch (error) {
            console.error('[User Chat] Failed to fetch messages', error)
            setError('Failed to load messages')
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

        setError(null)
        setSending(true)
        try {
            const res = await fetch(`/api/support/threads/${thread.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: newMessage })
            })
            const data = await res.json()
            
            if (!res.ok) {
                setError(data.error || 'Failed to send message')
                console.error('Failed to send message:', data)
                return
            }
            
            if (data.message) {
                setMessages(prev => [...prev, data.message])
                setNewMessage('')
                setTimeout(scrollToBottom, 100)
                onRefresh?.()
            } else {
                setError('No message returned from server')
                console.error('No message in response:', data)
            }
        } catch (error) {
            console.error('Failed to send message', error)
            setError('Network error - please try again')
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="bg-white border-b px-4 py-2 flex justify-between items-center text-xs text-gray-500">
                <span>ID: {thread.case_id || thread.id.slice(0, 8)}</span>
            </div>
            {error && (
                <div className="bg-red-50 border-b border-red-100 px-4 py-2 text-xs text-red-600">
                    {error}
                </div>
            )}
            
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4 pb-4">
                    {messages.length === 0 && !error && (
                        <div className="text-center py-8 text-gray-400">
                            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-20" />
                            <p className="text-sm">No messages yet</p>
                        </div>
                    )}
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
