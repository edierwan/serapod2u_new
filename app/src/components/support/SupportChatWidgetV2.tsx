'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
    Loader2,
    X,
    Check,
    CheckCheck,
    Clock,
    AlertCircle,
    CheckCircle2,
    RefreshCw,
    Paperclip,
    Phone,
    Bot,
    Smartphone
} from 'lucide-react'
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import Image from 'next/image'

// Types
interface Conversation {
    id: string
    case_number: string
    subject: string
    status: 'open' | 'pending_user' | 'pending_admin' | 'resolved' | 'closed' | 'spam'
    last_message_preview: string
    last_message_at: string
    last_message_sender_type: string
    user_unread_count: number
    created_at: string
}

interface Message {
    id: string
    sender_type: 'user' | 'admin' | 'system'
    body_text: string
    attachments: any[]
    created_at: string
    read_by_user_at?: string
    read_by_admin_at?: string
    // WhatsApp sync fields
    channel?: 'app' | 'whatsapp' | 'admin_web' | 'ai'
    origin?: 'serapod' | 'whatsapp'
    sender_phone?: string
    metadata?: Record<string, any>
}

// Channel badge helper
const getChannelBadge = (channel?: string) => {
    if (channel === 'whatsapp') return { icon: Phone, label: 'WhatsApp', color: 'text-green-600' }
    if (channel === 'ai') return { icon: Bot, label: 'AI', color: 'text-amber-600' }
    return null
}

// Status badge config
const STATUS_CONFIG = {
    open: { label: 'Open', color: 'bg-blue-100 text-blue-700', icon: Clock },
    pending_user: { label: 'Awaiting your reply', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
    pending_admin: { label: 'Awaiting response', color: 'bg-orange-100 text-orange-700', icon: Clock },
    resolved: { label: 'Resolved', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    closed: { label: 'Closed', color: 'bg-gray-100 text-gray-700', icon: CheckCircle2 },
    spam: { label: 'Spam', color: 'bg-red-100 text-red-700', icon: AlertCircle }
}

interface SupportChatWidgetProps {
    onClose: () => void
    themeColor?: string
    prefillSubject?: string
}

// Main Component
export function SupportChatWidgetV2({ onClose, themeColor = '#2563eb', prefillSubject }: SupportChatWidgetProps) {
    const [view, setView] = useState<'inbox' | 'new-chat' | 'thread'>('inbox')
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
    const [loading, setLoading] = useState(false)
    const [totalUnread, setTotalUnread] = useState(0)
    const [initialSubject, setInitialSubject] = useState('')
    
    // Check for prefill from sessionStorage on mount
    useEffect(() => {
        const storedSubject = sessionStorage.getItem('prefill_chat_subject')
        if (storedSubject) {
            setInitialSubject(storedSubject)
            sessionStorage.removeItem('prefill_chat_subject')
            // Auto-navigate to new chat view
            setView('new-chat')
        } else if (prefillSubject) {
            setInitialSubject(prefillSubject)
            setView('new-chat')
        }
    }, [prefillSubject])
    
    // Fetch conversations
    const fetchConversations = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/support/conversations')
            const data = await res.json()
            if (data.conversations) {
                setConversations(data.conversations)
                // Calculate total unread
                const unread = data.conversations.reduce((sum: number, c: Conversation) => sum + (c.user_unread_count || 0), 0)
                setTotalUnread(unread)
            }
        } catch (error) {
            console.error('Failed to fetch conversations', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchConversations()
    }, [fetchConversations])

    const handleConversationClick = (conv: Conversation) => {
        setActiveConversation(conv)
        setView('thread')
    }

    const handleBack = () => {
        if (view === 'thread') {
            setActiveConversation(null)
            setView('inbox')
            fetchConversations()
        } else if (view === 'new-chat') {
            setView('inbox')
        }
    }

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/support/conversations/${id}`, { method: 'DELETE' })
            if (res.ok) {
                fetchConversations()
            }
        } catch (error) {
            console.error('Failed to delete', error)
        }
    }

    const handleNewConversation = async (conversationId: string) => {
        setInitialSubject('') // Clear after use
        await fetchConversations()
        const conv = conversations.find(c => c.id === conversationId)
        if (conv) {
            setActiveConversation(conv)
            setView('thread')
        } else {
            setView('inbox')
        }
    }

    // Adjust color for hover state
    const adjustColorBrightness = (hex: string, percent: number) => {
        const num = parseInt(hex.replace('#', ''), 16)
        const amt = Math.round(2.55 * percent)
        const R = (num >> 16) + amt
        const G = (num >> 8 & 0x00FF) + amt
        const B = (num & 0x0000FF) + amt
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div 
                className="flex items-center justify-between p-4 text-white sticky top-0 z-10 shadow-md"
                style={{ backgroundColor: themeColor }}
            >
                <div className="flex items-center gap-3">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={view === 'inbox' ? onClose : handleBack}
                        className="text-white hover:bg-white/20 -ml-2"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h2 className="text-lg font-semibold">
                            {view === 'inbox' ? 'Support Inbox' : 
                             view === 'new-chat' ? 'New Conversation' : 
                             activeConversation?.subject || 'Chat'}
                        </h2>
                        {view === 'thread' && activeConversation && (
                            <p className="text-xs text-white/70">{activeConversation.case_number}</p>
                        )}
                    </div>
                </div>
                {totalUnread > 0 && view === 'inbox' && (
                    <Badge className="bg-red-500 text-white h-6 min-w-[24px] flex items-center justify-center rounded-full">
                        {totalUnread}
                    </Badge>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {view === 'inbox' && (
                    <InboxView 
                        conversations={conversations} 
                        loading={loading} 
                        onConversationClick={handleConversationClick} 
                        onNewChat={() => setView('new-chat')}
                        onDelete={handleDelete}
                        onRefresh={fetchConversations}
                        themeColor={themeColor}
                    />
                )}
                {view === 'new-chat' && (
                    <NewChatView 
                        onCancel={() => setView('inbox')}
                        onSuccess={handleNewConversation}
                        initialSubject={initialSubject}
                        themeColor={themeColor}
                    />
                )}
                {view === 'thread' && activeConversation && (
                    <ChatThreadView 
                        conversation={activeConversation}
                        onRefresh={fetchConversations}
                    />
                )}
            </div>
        </div>
    )
}

// Inbox View
function InboxView({ 
    conversations, 
    loading, 
    onConversationClick, 
    onNewChat, 
    onDelete,
    onRefresh,
    themeColor = '#2563eb'
}: { 
    conversations: Conversation[]
    loading: boolean
    onConversationClick: (conv: Conversation) => void
    onNewChat: () => void
    onDelete: (id: string) => void
    onRefresh: () => void
    themeColor?: string
}) {
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        setDeleteConfirm(id)
    }

    const confirmDelete = async (id: string) => {
        setDeleting(true)
        await onDelete(id)
        setDeleting(false)
        setDeleteConfirm(null)
    }

    const formatMessageTime = (dateStr: string) => {
        const date = new Date(dateStr)
        if (isToday(date)) {
            return format(date, 'HH:mm')
        } else if (isYesterday(date)) {
            return 'Yesterday'
        }
        return format(date, 'MMM d')
    }

    if (loading && conversations.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p className="text-gray-500">Loading conversations...</p>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col">
            {/* Pull to refresh hint */}
            <div className="flex justify-center py-2">
                <Button variant="ghost" size="sm" onClick={onRefresh} className="text-xs text-gray-400">
                    <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                </Button>
            </div>
            
            <ScrollArea className="flex-1 px-4">
                <div className="space-y-3 pb-24">
                    {conversations.length === 0 ? (
                        <div className="text-center py-12">
                            <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-200" />
                            <p className="text-gray-500 font-medium">No conversations yet</p>
                            <p className="text-sm text-gray-400 mt-1">Start a new conversation to get help</p>
                        </div>
                    ) : (
                        conversations.map((conv) => {
                            const status = STATUS_CONFIG[conv.status]
                            
                            return (
                                <div 
                                    key={conv.id}
                                    className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden active:scale-[0.98] transition-transform"
                                >
                                    {deleteConfirm === conv.id ? (
                                        <div className="p-4 bg-red-50 flex items-center justify-between">
                                            <span className="text-sm text-red-700">Delete this conversation?</span>
                                            <div className="flex gap-2">
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    onClick={() => setDeleteConfirm(null)}
                                                    disabled={deleting}
                                                    className="h-8"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button 
                                                    size="sm" 
                                                    variant="destructive" 
                                                    onClick={() => confirmDelete(conv.id)}
                                                    disabled={deleting}
                                                    className="h-8"
                                                >
                                                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div 
                                            onClick={() => onConversationClick(conv)}
                                            className="p-4 cursor-pointer"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <h3 className={cn(
                                                        "font-semibold truncate",
                                                        conv.user_unread_count > 0 ? "text-gray-900" : "text-gray-700"
                                                    )}>
                                                        {conv.subject}
                                                    </h3>
                                                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                                        {conv.case_number}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 ml-2 shrink-0">
                                                    <span className="text-xs text-gray-400">
                                                        {formatMessageTime(conv.last_message_at)}
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-gray-300 hover:text-red-500"
                                                        onClick={(e) => handleDelete(e, conv.id)}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                            
                                            <div className="flex justify-between items-center">
                                                <p className={cn(
                                                    "text-sm truncate flex-1 pr-4",
                                                    conv.user_unread_count > 0 ? "text-gray-900 font-medium" : "text-gray-500"
                                                )}>
                                                    {conv.last_message_sender_type === 'user' && (
                                                        <span className="text-blue-600 mr-1">You:</span>
                                                    )}
                                                    {conv.last_message_preview || 'No messages'}
                                                </p>
                                                
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {conv.user_unread_count > 0 && (
                                                        <Badge className="bg-red-500 text-white rounded-full h-5 min-w-[20px] px-1.5 text-xs">
                                                            {conv.user_unread_count}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </ScrollArea>
            
            {/* Floating Action Button */}
            <div className="absolute bottom-4 left-0 right-0 px-4">
                <Button 
                    onClick={onNewChat} 
                    className="w-full shadow-lg rounded-full h-14 text-base font-medium text-white"
                    style={{ backgroundColor: themeColor }}
                >
                    <Plus className="w-5 h-5 mr-2" /> Start New Conversation
                </Button>
            </div>
        </div>
    )
}

// New Chat View
function NewChatView({ 
    onCancel, 
    onSuccess,
    initialSubject = '',
    themeColor = '#2563eb'
}: { 
    onCancel: () => void
    onSuccess: (conversationId: string) => void
    initialSubject?: string
    themeColor?: string 
}) {
    const supabase = createClient()
    const [subject, setSubject] = useState(initialSubject)
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [attachments, setAttachments] = useState<any[]>([])
    const [uploading, setUploading] = useState(false)
    const [compressionInfo, setCompressionInfo] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    
    // Set initial subject when prop changes
    useEffect(() => {
        if (initialSubject) {
            setSubject(initialSubject)
        }
    }, [initialSubject])

    // Image compression
    const compressImage = async (file: File, maxWidth: number = 1200, quality: number = 0.8): Promise<{ blob: Blob; originalSize: number; compressedSize: number }> => {
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

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file')
            return
        }

        if (file.size > 10 * 1024 * 1024) {
            alert('Image must be less than 10MB')
            return
        }

        setUploading(true)
        setCompressionInfo(null)
        
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                alert('Please login to upload images')
                return
            }

            let fileToUpload: Blob | File = file
            let compressionMsg = ''
            
            if (file.size > 500 * 1024) {
                try {
                    const { blob, originalSize, compressedSize } = await compressImage(file)
                    fileToUpload = blob
                    const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(0)
                    compressionMsg = `Optimized: ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)} (${savings}% smaller)`
                    setCompressionInfo(compressionMsg)
                } catch (compressError) {
                    console.error('Compression failed, using original:', compressError)
                    compressionMsg = `Size: ${formatFileSize(file.size)}`
                    setCompressionInfo(compressionMsg)
                }
            } else {
                compressionMsg = `Size: ${formatFileSize(file.size)}`
                setCompressionInfo(compressionMsg)
            }

            const fileExt = file.type === 'image/png' ? 'png' : 'jpg'
            const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

            const { data, error } = await supabase.storage
                .from('support-attachments')
                .upload(fileName, fileToUpload, { contentType: 'image/jpeg' })

            if (error) {
                console.error('Upload error:', error)
                alert('Failed to upload image: ' + error.message)
                return
            }

            const { data: { publicUrl } } = supabase.storage
                .from('support-attachments')
                .getPublicUrl(fileName)

            const localPreviewUrl = URL.createObjectURL(fileToUpload)

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
            const res = await fetch('/api/support/conversations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject, message, attachments })
            })
            const data = await res.json()
            if (data.conversationId) {
                onSuccess(data.conversationId)
            }
        } catch (error) {
            console.error('Failed to create conversation', error)
            alert('Failed to create conversation. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="p-4 h-full flex flex-col bg-white">
            <form onSubmit={handleSubmit} className="space-y-4 flex-1 flex flex-col">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
                    <Input 
                        value={subject} 
                        onChange={(e) => setSubject(e.target.value)} 
                        placeholder="What is this about?"
                        required
                        className="bg-gray-50 h-12 text-base"
                    />
                </div>
                
                <div className="flex-1 flex flex-col">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Message</label>
                    <Textarea 
                        value={message} 
                        onChange={(e) => setMessage(e.target.value)} 
                        placeholder="Describe your issue..."
                        required
                        className="flex-1 bg-gray-50 resize-none min-h-[150px] text-base"
                    />
                </div>
                
                {/* Image Upload */}
                <div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                    />
                    
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || attachments.length >= 3}
                            className="h-10"
                        >
                            {uploading ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                                <ImageIcon className="w-4 h-4 mr-2" />
                            )}
                            Attach Image
                        </Button>
                        <span className="text-xs text-gray-400">Optional (max 5MB)</span>
                    </div>
                    
                    {compressionInfo && (
                        <p className="text-xs text-green-600 mt-1">{compressionInfo}</p>
                    )}
                    
                    {/* Attachment Preview */}
                    {attachments.length > 0 && (
                        <div className="flex gap-2 mt-3 flex-wrap">
                            {attachments.map((att, index) => (
                                <div key={index} className="relative group">
                                    <div className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                                        <Image
                                            src={att.previewUrl || att.url}
                                            alt={att.name}
                                            width={80}
                                            height={80}
                                            className="object-cover w-full h-full"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(index)}
                                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <Button 
                    type="submit" 
                    disabled={!subject.trim() || !message.trim() || loading}
                    className="w-full h-14 text-base font-medium rounded-xl text-white"
                    style={{ backgroundColor: themeColor }}
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="w-5 h-5 mr-2" />
                            Send Message
                        </>
                    )}
                </Button>
            </form>
        </div>
    )
}

// Chat Thread View
function ChatThreadView({ 
    conversation, 
    onRefresh 
}: { 
    conversation: Conversation
    onRefresh: () => void 
}) {
    const [messages, setMessages] = useState<Message[]>([])
    const [newMessage, setNewMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    // Fetch messages
    const fetchMessages = async () => {
        try {
            const res = await fetch(`/api/support/conversations/${conversation.id}/messages?limit=100`)
            const data = await res.json()
            if (data.messages) {
                setMessages(data.messages.reverse())
                setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
            }
        } catch (error) {
            console.error('Failed to fetch messages', error)
        } finally {
            setLoading(false)
        }
    }

    // Mark as read
    const markAsRead = async () => {
        try {
            await fetch(`/api/support/conversations/${conversation.id}/read`, { method: 'POST' })
        } catch (error) {
            console.error('Failed to mark as read', error)
        }
    }

    useEffect(() => {
        fetchMessages()
        markAsRead()
    }, [conversation.id])

    // Send message
    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault()
        const msg = newMessage.trim()
        if (!msg) return
        
        setError(null)
        setSending(true)
        
        try {
            const res = await fetch(`/api/support/conversations/${conversation.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            })
            
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to send message')
            }
            
            setNewMessage('')
            fetchMessages()
            onRefresh()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSending(false)
        }
    }

    // Group messages by date
    const groupedMessages = messages.reduce((groups: { date: string; messages: Message[] }[], msg) => {
        const date = format(new Date(msg.created_at), 'yyyy-MM-dd')
        const lastGroup = groups[groups.length - 1]
        
        if (lastGroup && lastGroup.date === date) {
            lastGroup.messages.push(msg)
        } else {
            groups.push({ date, messages: [msg] })
        }
        
        return groups
    }, [])

    const formatDateHeader = (dateStr: string) => {
        const date = new Date(dateStr)
        if (isToday(date)) return 'Today'
        if (isYesterday(date)) return 'Yesterday'
        return format(date, 'EEEE, MMMM d')
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            {/* Error banner */}
            {error && (
                <div className="bg-red-50 border-b border-red-100 px-4 py-2 text-sm text-red-600 flex items-center justify-between">
                    <span>{error}</span>
                    <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 text-red-600 hover:text-red-800">
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Messages */}
            <ScrollArea className="flex-1 px-3">
                <div className="py-4 space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        </div>
                    ) : (
                        groupedMessages.map((group) => (
                            <div key={group.date}>
                                {/* Date Header */}
                                <div className="flex justify-center mb-4">
                                    <span className="bg-white text-gray-500 text-xs px-3 py-1 rounded-full shadow-sm">
                                        {formatDateHeader(group.date)}
                                    </span>
                                </div>
                                
                                {/* Messages */}
                                <div className="space-y-2">
                                    {group.messages.map((msg) => {
                                        const isUser = msg.sender_type === 'user'
                                        const isSystem = msg.sender_type === 'system'
                                        const channelBadge = getChannelBadge(msg.channel)
                                        const isWhatsApp = msg.channel === 'whatsapp'
                                        const isAI = msg.channel === 'ai'
                                        
                                        if (isSystem) {
                                            return (
                                                <div key={msg.id} className="flex justify-center my-4">
                                                    <span className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
                                                        {msg.body_text}
                                                    </span>
                                                </div>
                                            )
                                        }

                                        return (
                                            <div 
                                                key={msg.id} 
                                                className={cn("flex", isUser ? "justify-end" : "justify-start")}
                                            >
                                                <div className={cn(
                                                    "max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm relative",
                                                    isUser 
                                                        ? "bg-blue-600 text-white rounded-br-md" 
                                                        : isWhatsApp
                                                            ? "bg-green-50 text-gray-900 border border-green-200 rounded-bl-md"
                                                            : isAI
                                                                ? "bg-amber-50 text-gray-900 border border-amber-200 rounded-bl-md"
                                                                : "bg-white text-gray-900 rounded-bl-md"
                                                )}>
                                                    {/* Channel indicator for non-user messages */}
                                                    {!isUser && channelBadge && (
                                                        <div className={cn(
                                                            "flex items-center gap-1 text-[10px] mb-1 font-medium",
                                                            channelBadge.color
                                                        )}>
                                                            <channelBadge.icon className="w-3 h-3" />
                                                            {isWhatsApp ? 'via WhatsApp' : 'AI Assistant'}
                                                        </div>
                                                    )}
                                                    
                                                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.body_text}</p>
                                                    
                                                    {/* Attachments */}
                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div className="mt-2 space-y-2">
                                                            {msg.attachments.map((att: any, i: number) => (
                                                                att.type?.startsWith('image/') || att.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                                                    <a 
                                                                        key={i}
                                                                        href={att.url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer"
                                                                        className="block"
                                                                    >
                                                                        <Image
                                                                            src={att.url}
                                                                            alt="Attachment"
                                                                            width={200}
                                                                            height={150}
                                                                            className="rounded-lg max-w-full"
                                                                        />
                                                                    </a>
                                                                ) : (
                                                                    <a 
                                                                        key={i} 
                                                                        href={att.url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer"
                                                                        className={cn(
                                                                            "flex items-center gap-1.5 text-xs underline",
                                                                            isUser ? "text-blue-100" : "text-blue-600"
                                                                        )}
                                                                    >
                                                                        <Paperclip className="w-3 h-3" />
                                                                        {att.name || 'Attachment'}
                                                                    </a>
                                                                )
                                                            ))}
                                                        </div>
                                                    )}
                                                    
                                                    <div className={cn(
                                                        "text-[11px] mt-1 flex items-center gap-1",
                                                        isUser ? "justify-end text-blue-200" : "justify-start text-gray-400"
                                                    )}>
                                                        {format(new Date(msg.created_at), 'HH:mm')}
                                                        {isUser && (
                                                            msg.read_by_admin_at ? (
                                                                <CheckCheck className="w-3.5 h-3.5 text-blue-200" />
                                                            ) : (
                                                                <Check className="w-3.5 h-3.5 text-blue-200" />
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={scrollRef} />
                </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="p-3 bg-white border-t shadow-lg">
                <form onSubmit={handleSend} className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                        <Textarea
                            ref={inputRef}
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="resize-none min-h-[44px] max-h-[120px] pr-12 py-3 rounded-2xl border-gray-200 focus:border-blue-300 text-[15px]"
                            rows={1}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSend()
                                }
                            }}
                        />
                    </div>
                    <Button 
                        type="submit" 
                        disabled={!newMessage.trim() || sending}
                        className="h-11 w-11 rounded-full bg-blue-600 hover:bg-blue-700 p-0 shrink-0"
                    >
                        {sending ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <Send className="w-5 h-5" />
                        )}
                    </Button>
                </form>
            </div>
        </div>
    )
}

export default SupportChatWidgetV2
