'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
    MessageSquare,
    Search,
    RefreshCw,
    Send,
    Image as ImageIcon,
    Megaphone,
    Loader2,
    User,
    ArrowLeft,
    X,
    Tag,
    StickyNote,
    Clock,
    CheckCircle2,
    AlertCircle,
    ChevronDown,
    MoreHorizontal,
    UserPlus,
    Flag,
    Filter,
    Archive,
    Inbox,
    Users,
    AlertTriangle,
    MessageCircle,
    Eye,
    EyeOff,
    Paperclip,
    Phone,
    Smartphone,
    Bot,
    Sparkles,
    Zap,
    Globe
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Types
interface Conversation {
    id: string
    case_number: string
    subject: string
    status: 'open' | 'pending_user' | 'pending_admin' | 'resolved' | 'closed' | 'spam'
    priority: 'low' | 'normal' | 'high' | 'urgent'
    last_message_preview: string
    last_message_at: string
    last_message_sender_type: string
    admin_unread_count: number
    created_at: string
    created_by: {
        email: string
        full_name: string
        phone: string
    }
    assigned_to?: {
        id: string
        email: string
        full_name: string
    }
    tags?: Array<{ id: string; name: string; color: string }>
    is_unread: boolean
}

interface Message {
    id: string
    sender_type: 'user' | 'admin' | 'system'
    sender_admin_id?: string
    body_text: string
    attachments: any[]
    created_at: string
    read_by_user_at?: string
    read_by_admin_at?: string
    // WhatsApp sync fields
    channel?: 'app' | 'whatsapp' | 'admin_web' | 'ai'
    direction?: 'inbound' | 'outbound'
    sender_phone?: string
    origin?: 'serapod' | 'whatsapp'
    external_message_id?: string
    metadata?: Record<string, any>
}

interface ConversationNote {
    id: string
    note_text: string
    admin_id: string
    admin?: { full_name: string; email: string }
    created_at: string
}

interface Admin {
    id: string
    full_name: string
    email: string
    role_code: string
}

interface Tag {
    id: string
    name: string
    color: string
}

// Channel configuration for badges
const CHANNEL_CONFIG = {
    app: { label: 'App', color: 'bg-blue-100 text-blue-700', icon: Smartphone },
    whatsapp: { label: 'WhatsApp', color: 'bg-green-100 text-green-700', icon: Phone },
    admin_web: { label: 'Web', color: 'bg-purple-100 text-purple-700', icon: Globe },
    ai: { label: 'AI', color: 'bg-amber-100 text-amber-700', icon: Bot }
}

// Status configuration
const STATUS_CONFIG = {
    open: { label: 'Open', color: 'bg-blue-100 text-blue-800', icon: Inbox },
    pending_user: { label: 'Pending User', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
    pending_admin: { label: 'Pending Admin', color: 'bg-orange-100 text-orange-800', icon: AlertCircle },
    resolved: { label: 'Resolved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
    closed: { label: 'Closed', color: 'bg-gray-100 text-gray-800', icon: Archive },
    spam: { label: 'Spam', color: 'bg-red-100 text-red-800', icon: AlertTriangle }
}

const PRIORITY_CONFIG = {
    low: { label: 'Low', color: 'bg-gray-100 text-gray-600' },
    normal: { label: 'Normal', color: 'bg-blue-100 text-blue-600' },
    high: { label: 'High', color: 'bg-orange-100 text-orange-600' },
    urgent: { label: 'Urgent', color: 'bg-red-100 text-red-600' }
}

// Main Component
export function AdminSupportInboxV2() {
    const [view, setView] = useState<'list' | 'detail'>('list')
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
    const [loading, setLoading] = useState(false)
    const [showBlastModal, setShowBlastModal] = useState(false)

    // Filters
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')
    const [assignedFilter, setAssignedFilter] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const [rowsPerPage, setRowsPerPage] = useState(20)
    const [totalCount, setTotalCount] = useState(0)

    // Data for dropdowns
    const [admins, setAdmins] = useState<Admin[]>([])
    const [tags, setTags] = useState<Tag[]>([])

    const totalPages = Math.ceil(totalCount / rowsPerPage)

    // Fetch conversations
    const fetchConversations = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'all') params.append('status', statusFilter)
            if (priorityFilter !== 'all') params.append('priority', priorityFilter)
            if (assignedFilter !== 'all') params.append('assigned', assignedFilter)
            if (searchQuery) params.append('q', searchQuery)
            params.append('page', currentPage.toString())
            params.append('limit', rowsPerPage.toString())

            const res = await fetch(`/api/admin/support/conversations?${params.toString()}`)
            const data = await res.json()

            if (data.conversations) {
                setConversations(data.conversations)
                setTotalCount(data.total || data.conversations.length)
            }
        } catch (error) {
            console.error('Failed to fetch conversations', error)
        } finally {
            setLoading(false)
        }
    }, [statusFilter, priorityFilter, assignedFilter, searchQuery, currentPage, rowsPerPage])

    // Fetch admin list
    const fetchAdmins = async () => {
        try {
            const res = await fetch('/api/admin/support/admins')
            const data = await res.json()
            if (data.admins) setAdmins(data.admins)
        } catch (error) {
            console.error('Failed to fetch admins', error)
        }
    }

    // Fetch tags
    const fetchTags = async () => {
        try {
            const res = await fetch('/api/admin/support/tags')
            const data = await res.json()
            if (data.tags) setTags(data.tags)
        } catch (error) {
            console.error('Failed to fetch tags', error)
        }
    }

    useEffect(() => {
        fetchConversations()
        fetchAdmins()
        fetchTags()
    }, [fetchConversations])

    const handleConversationClick = (conv: Conversation) => {
        setActiveConversation(conv)
        setView('detail')
    }

    const handleSearch = () => {
        setCurrentPage(1)
        fetchConversations()
    }

    const handleStatusChange = async (convId: string, newStatus: string) => {
        try {
            await fetch(`/api/admin/support/conversations/${convId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            })
            fetchConversations()
        } catch (error) {
            console.error('Failed to update status', error)
        }
    }

    const handleAssign = async (convId: string, adminId: string | null) => {
        try {
            await fetch(`/api/admin/support/conversations/${convId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigned_admin_id: adminId })
            })
            fetchConversations()
        } catch (error) {
            console.error('Failed to assign', error)
        }
    }

    return (
        <div className="h-[700px] min-h-[500px] flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden">
            {view === 'list' ? (
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="px-6 py-5 border-b flex items-center justify-between bg-white">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">Support Inbox</h2>
                            <p className="text-sm text-gray-500 mt-1">Monitor and respond to user inquiries from WhatsApp and App</p>
                        </div>
                        <div className="flex gap-2">
                             <Button onClick={fetchConversations} variant="outline" size="sm" className="gap-2">
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                                Refresh
                            </Button>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="p-4 border-b flex flex-wrap items-center gap-3 bg-gray-50/50">
                        {/* Search */}
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                            <Input
                                placeholder="Search subjects, user name, phone, case #..."
                                className="pl-9 bg-white"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                        </div>

                        {/* Filters */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1) }}>
                                <SelectTrigger className="w-[140px] bg-white">
                                    <Filter className="w-3.5 h-3.5 mr-2 text-gray-500" />
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="open">Open</SelectItem>
                                    <SelectItem value="pending_user">Pending User</SelectItem>
                                    <SelectItem value="pending_admin">Pending Admin</SelectItem>
                                    <SelectItem value="resolved">Resolved</SelectItem>
                                    <SelectItem value="closed">Closed</SelectItem>
                                    <SelectItem value="spam">Spam</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setCurrentPage(1) }}>
                                <SelectTrigger className="w-[130px] bg-white">
                                    <Flag className="w-3.5 h-3.5 mr-2 text-gray-500" />
                                    <SelectValue placeholder="Priority" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Priority</SelectItem>
                                    <SelectItem value="low">Low</SelectItem>
                                    <SelectItem value="normal">Normal</SelectItem>
                                    <SelectItem value="high">High</SelectItem>
                                    <SelectItem value="urgent">Urgent</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={assignedFilter} onValueChange={(v) => { setAssignedFilter(v); setCurrentPage(1) }}>
                                <SelectTrigger className="w-[140px] bg-white">
                                    <Users className="w-3.5 h-3.5 mr-2 text-gray-500" />
                                    <SelectValue placeholder="Assigned" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="me">Assigned to Me</SelectItem>
                                    <SelectItem value="unassigned">Unassigned</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex-1" />

                        <Button onClick={() => setShowBlastModal(true)} className="bg-purple-600 hover:bg-purple-700 text-white">
                            <Megaphone className="w-4 h-4 mr-2" />
                            Blast Announcement
                        </Button>
                    </div>

                    {/* Conversation List */}
                    <ScrollArea className="flex-1">
                        <div className="divide-y">
                            {loading ? (
                                <div className="p-8 text-center text-gray-500">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                    Loading conversations...
                                </div>
                            ) : conversations.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">
                                    <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                    No conversations found.
                                </div>
                            ) : (
                                conversations.map((conv, index) => (
                                    <ConversationRow
                                        key={conv.id}
                                        conversation={conv}
                                        index={(currentPage - 1) * rowsPerPage + index + 1}
                                        onClick={() => handleConversationClick(conv)}
                                        onStatusChange={handleStatusChange}
                                        onAssign={handleAssign}
                                        admins={admins}
                                    />
                                ))
                            )}
                        </div>
                    </ScrollArea>

                    {/* Pagination */}
                    {!loading && conversations.length > 0 && (
                        <div className="p-3 border-t bg-gray-50/50 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <span>Rows per page:</span>
                                <Select value={rowsPerPage.toString()} onValueChange={(v) => { setRowsPerPage(parseInt(v)); setCurrentPage(1) }}>
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
                                <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="h-8 px-2">
                                    First
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-8 px-2">
                                    Prev
                                </Button>
                                <span className="px-3 text-sm text-gray-600">
                                    Page {currentPage} of {totalPages || 1}
                                </span>
                                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="h-8 px-2">
                                    Next
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages} className="h-8 px-2">
                                    Last
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <ConversationDetailView
                    conversation={activeConversation!}
                    admins={admins}
                    tags={tags}
                    onBack={() => {
                        setView('list')
                        fetchConversations()
                    }}
                    onUpdate={fetchConversations}
                />
            )}

            <BlastAnnouncementModal open={showBlastModal} onOpenChange={setShowBlastModal} />
        </div>
    )
}

// Conversation Row Component
function ConversationRow({
    conversation,
    index,
    onClick,
    onStatusChange,
    onAssign,
    admins
}: {
    conversation: Conversation & { primary_channel?: string; whatsapp_user_phone?: string }
    index: number
    onClick: () => void
    onStatusChange: (id: string, status: string) => void
    onAssign: (id: string, adminId: string | null) => void
    admins: Admin[]
}) {
    const statusConfig = STATUS_CONFIG[conversation.status]
    const priorityConfig = PRIORITY_CONFIG[conversation.priority]
    const StatusIcon = statusConfig.icon
    const isWhatsAppConversation = conversation.primary_channel === 'whatsapp' || !!conversation.whatsapp_user_phone

    return (
        <div
            onClick={onClick}
            className={cn(
                "p-4 hover:bg-blue-50/50 cursor-pointer transition-all",
                conversation.is_unread && "bg-blue-50/30",
                isWhatsAppConversation && "border-l-4 border-l-green-500"
            )}
        >
            <div className="flex items-start gap-3">
                {/* Row number */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
                    {index}
                </div>

                <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className={cn(
                                "text-sm font-medium truncate max-w-[200px]",
                                conversation.is_unread ? "text-gray-900 font-bold" : "text-gray-700"
                            )}>
                                {conversation.subject}
                            </h4>
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                {conversation.case_number}
                            </span>
                            {isWhatsAppConversation && (
                                <Badge className="h-5 px-1.5 bg-green-100 text-green-700 text-[10px]">
                                    <Phone className="w-3 h-3 mr-0.5" />
                                    WA
                                </Badge>
                            )}
                            {conversation.is_unread && (
                                <Badge className="h-1.5 w-1.5 rounded-full p-0 bg-blue-600" />
                            )}
                            <Badge className={cn("text-[10px] h-5 px-1.5", statusConfig.color)}>
                                <StatusIcon className="w-3 h-3 mr-1" />
                                {statusConfig.label}
                            </Badge>
                            {conversation.priority !== 'normal' && (
                                <Badge className={cn("text-[10px] h-5 px-1.5", priorityConfig.color)}>
                                    {priorityConfig.label}
                                </Badge>
                            )}
                        </div>
                        <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                            {format(new Date(conversation.last_message_at), 'MMM d, HH:mm')}
                        </span>
                    </div>

                    {/* Preview */}
                    <p className="text-sm text-gray-500 truncate mb-2">
                        {conversation.last_message_sender_type === 'admin' && (
                            <span className="text-blue-600 mr-1">You:</span>
                        )}
                        {conversation.last_message_preview || 'No messages'}
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {conversation.created_by?.full_name || 'Unknown User'}
                        </span>
                        {conversation.created_by?.phone && (
                            <span className="text-blue-600">{conversation.created_by.phone}</span>
                        )}
                        {conversation.assigned_to && (
                            <span className="flex items-center gap-1">
                                <UserPlus className="w-3 h-3" />
                                {conversation.assigned_to.full_name}
                            </span>
                        )}
                        {conversation.tags && conversation.tags.length > 0 && (
                            <div className="flex items-center gap-1">
                                {conversation.tags.slice(0, 3).map(tag => (
                                    <span
                                        key={tag.id}
                                        className="px-1.5 py-0.5 rounded text-[10px]"
                                        style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                    >
                                        {tag.name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick actions */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Quick Actions</div>
                        <DropdownMenuItem onClick={() => onStatusChange(conversation.id, 'resolved')}>
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Resolved
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onStatusChange(conversation.id, 'closed')}>
                            <Archive className="w-4 h-4 mr-2" /> Close
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onStatusChange(conversation.id, 'spam')}>
                            <AlertTriangle className="w-4 h-4 mr-2" /> Mark as Spam
                        </DropdownMenuItem>
                        <div className="border-t border-gray-100 my-1"></div>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Assign to</div>
                        <DropdownMenuItem onClick={() => onAssign(conversation.id, null)}>
                            <User className="w-4 h-4 mr-2" /> Unassigned
                        </DropdownMenuItem>
                        {admins.slice(0, 5).map(admin => (
                            <DropdownMenuItem key={admin.id} onClick={() => onAssign(conversation.id, admin.id)}>
                                <User className="w-4 h-4 mr-2" /> {admin.full_name}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}

// Conversation Detail View
function ConversationDetailView({
    conversation,
    admins,
    tags,
    onBack,
    onUpdate
}: {
    conversation: Conversation
    admins: Admin[]
    tags: Tag[]
    onBack: () => void
    onUpdate: () => void
}) {
    const [messages, setMessages] = useState<Message[]>([])
    const [notes, setNotes] = useState<ConversationNote[]>([])
    const [loadingMessages, setLoadingMessages] = useState(true)
    const [newMessage, setNewMessage] = useState('')
    const [newNote, setNewNote] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [convDetails, setConvDetails] = useState(conversation)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [activeTab, setActiveTab] = useState('chat')

    // WhatsApp reply mode
    const [replyViaWhatsApp, setReplyViaWhatsApp] = useState(false)
    const [sendingWhatsApp, setSendingWhatsApp] = useState(false)

    // AI Assist
    const [aiLoading, setAiLoading] = useState(false)
    const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
    const [showAiPanel, setShowAiPanel] = useState(false)

    // AI Bot Mode (for Moltbot integration)
    const [botMode, setBotMode] = useState<'auto' | 'takeover'>('auto')
    const [botModeLoading, setBotModeLoading] = useState(false)
    const [pendingDraft, setPendingDraft] = useState<string | null>(null)
    const [draftLoading, setDraftLoading] = useState(false)

    // Check if conversation has WhatsApp
    const hasWhatsApp = !!(convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone

    // Get user phone for Moltbot API
    const userPhone = (convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone

    // Fetch bot mode from Moltbot
    const fetchBotMode = async () => {
        if (!userPhone) return

        try {
            const res = await fetch(`/api/support/bot/mode/${encodeURIComponent(userPhone)}`)
            if (res.ok) {
                const data = await res.json()
                if (data.ok) {
                    setBotMode(data.mode || 'auto')
                    setPendingDraft(data.draftPreview || null)
                }
            }
        } catch (error) {
            console.error('Failed to fetch bot mode', error)
        }
    }

    // Toggle bot mode
    const handleBotModeToggle = async (newMode: 'auto' | 'takeover') => {
        if (!userPhone || botModeLoading) return

        setBotModeLoading(true)
        try {
            const res = await fetch(`/api/support/bot/mode/${encodeURIComponent(userPhone)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode })
            })

            if (res.ok) {
                const data = await res.json()
                setBotMode(data.mode || newMode)
            }
        } catch (error) {
            console.error('Failed to update bot mode', error)
        } finally {
            setBotModeLoading(false)
        }
    }

    // Generate AI draft via Moltbot
    const handleGenerateDraft = async () => {
        if (!userPhone || draftLoading) return

        setDraftLoading(true)
        setError(null)

        try {
            const res = await fetch(`/api/support/bot/draft/${encodeURIComponent(userPhone)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction: '' })
            })

            const data = await res.json()

            if (data.ok && data.draft) {
                setPendingDraft(data.draft)
                setShowAiPanel(true)
                setAiSuggestion(data.draft)
            } else {
                setError(data.error || 'Failed to generate draft')
            }
        } catch (error) {
            setError('Failed to generate AI draft')
        } finally {
            setDraftLoading(false)
        }
    }

    // Send pending draft
    const handleSendDraft = async () => {
        if (!userPhone || !pendingDraft) return

        setSending(true)
        setError(null)

        try {
            const res = await fetch(`/api/support/bot/draft/${encodeURIComponent(userPhone)}/send`, {
                method: 'POST'
            })

            if (res.ok) {
                setPendingDraft(null)
                setAiSuggestion(null)
                setShowAiPanel(false)
                fetchMessages()
            } else {
                const data = await res.json()
                setError(data.error || 'Failed to send draft')
            }
        } catch (error) {
            setError('Failed to send draft')
        } finally {
            setSending(false)
        }
    }

    // Fetch messages
    const fetchMessages = async () => {
        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}/messages?limit=100`)
            const data = await res.json()
            if (data.messages) {
                setMessages(data.messages.reverse())
                setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
            }
        } catch (error) {
            console.error('Failed to fetch messages', error)
        } finally {
            setLoadingMessages(false)
        }
    }

    // Fetch notes
    const fetchNotes = async () => {
        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}/notes`)
            const data = await res.json()
            if (data.notes) setNotes(data.notes)
        } catch (error) {
            console.error('Failed to fetch notes', error)
        }
    }

    // Fetch conversation details
    const fetchDetails = async () => {
        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}`)
            const data = await res.json()
            if (data.conversation) {
                setConvDetails(data.conversation)
                if (data.conversation.notes) setNotes(data.conversation.notes)
            }
        } catch (error) {
            console.error('Failed to fetch details', error)
        }
    }

    useEffect(() => {
        fetchMessages()
        fetchDetails()
        fetchBotMode()
    }, [conversation.id])

    // Send message
    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault()
        const msg = newMessage.trim()
        if (!msg) return

        setError(null)
        setSending(true)

        try {
            // If WhatsApp reply mode is enabled and user has WhatsApp
            if (replyViaWhatsApp && hasWhatsApp) {
                setSendingWhatsApp(true)
                const waRes = await fetch('/api/support/whatsapp/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        threadId: conversation.id,
                        toPhoneE164: (convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone,
                        text: msg
                    })
                })

                const waData = await waRes.json()
                setSendingWhatsApp(false)

                if (!waRes.ok) {
                    // Still saved in DB, show warning
                    if (waData.storedInDb) {
                        setError(`WhatsApp delivery failed: ${waData.error}. Message saved in app.`)
                    } else {
                        throw new Error(waData.error || 'Failed to send via WhatsApp')
                    }
                }

                setNewMessage('')
                setAiSuggestion(null)
                fetchMessages()
                onUpdate()
            } else {
                // Normal app message
                const res = await fetch(`/api/admin/support/conversations/${conversation.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg })
                })

                if (!res.ok) {
                    const data = await res.json()
                    throw new Error(data.error || 'Failed to send message')
                }

                setNewMessage('')
                setAiSuggestion(null)
                fetchMessages()
                onUpdate()
            }
        } catch (err: any) {
            if (err.message === 'User not found') {
                setError('Failed: Admin profile missing. Please contact developer.')
            } else {
                setError(err.message)
            }
        } finally {
            setSending(false)
            setSendingWhatsApp(false)
        }
    }

    // AI Assist handler
    const handleAiAssist = async () => {
        setAiLoading(true)
        setError(null)
        setShowAiPanel(true)

        try {
            const res = await fetch('/api/agent/assist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversationId: conversation.id,
                    tone: 'friendly'
                })
            })

            const data = await res.json()

            if (data.ok && data.suggestedReply) {
                setAiSuggestion(data.suggestedReply)
            } else {
                // Handle "User not found" gracefully - likely auth sync issue
                if (data.error === 'User not found') {
                    console.warn('AI Assist: Admin user not found in DB')
                    // Show a milder error or suppress it for AI panel
                    setError('AI Assistant unavailable (Admin profile missing)')
                } else {
                    setError(data.error || 'AI assist unavailable')
                }
            }
        } catch (err: any) {
            setError('Failed to get AI suggestion')
        } finally {
            setAiLoading(false)
        }
    }

    // Use AI suggestion
    const useAiSuggestion = () => {
        if (aiSuggestion) {
            setNewMessage(aiSuggestion)
            setShowAiPanel(false)
        }
    }

    // Add note
    const handleAddNote = async () => {
        const note = newNote.trim()
        if (!note) return

        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_text: note })
            })

            if (res.ok) {
                setNewNote('')
                fetchNotes()
            }
        } catch (error) {
            console.error('Failed to add note', error)
        }
    }

    // Update status
    const handleStatusChange = async (newStatus: string) => {
        try {
            await fetch(`/api/admin/support/conversations/${conversation.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            })
            setConvDetails(prev => ({ ...prev, status: newStatus as any }))
            onUpdate()
        } catch (error) {
            console.error('Failed to update status', error)
        }
    }

    // Update priority
    const handlePriorityChange = async (newPriority: string) => {
        try {
            await fetch(`/api/admin/support/conversations/${conversation.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority: newPriority })
            })
            setConvDetails(prev => ({ ...prev, priority: newPriority as any }))
        } catch (error) {
            console.error('Failed to update priority', error)
        }
    }

    // Update assignment
    const handleAssignChange = async (adminId: string | null) => {
        try {
            await fetch(`/api/admin/support/conversations/${conversation.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigned_admin_id: adminId })
            })
            const admin = admins.find(a => a.id === adminId)
            setConvDetails(prev => ({
                ...prev,
                assigned_to: admin ? { id: admin.id, email: admin.email, full_name: admin.full_name } : undefined
            }))
            onUpdate()
        } catch (error) {
            console.error('Failed to update assignment', error)
        }
    }

    const statusConfig = STATUS_CONFIG[convDetails.status]

    return (
        <div className="flex h-full">
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="p-4 border-b flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-gray-900">{convDetails.subject}</h3>
                                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                                    {convDetails.case_number}
                                </span>
                            </div>
                            <p className="text-xs text-gray-500">
                                {convDetails.created_by?.full_name} • {convDetails.created_by?.email} • {convDetails.created_by?.phone}
                            </p>
                        </div>
                    </div>

                    {/* AI Bot Mode Controls */}
                    {hasWhatsApp && userPhone && (
                        <div className="flex items-center gap-3">
                            {/* Mode Badge */}
                            <Badge
                                className={cn(
                                    "text-xs font-medium",
                                    botMode === 'auto'
                                        ? "bg-green-100 text-green-700 hover:bg-green-100"
                                        : "bg-orange-100 text-orange-700 hover:bg-orange-100"
                                )}
                            >
                                <Bot className="w-3 h-3 mr-1" />
                                {botMode === 'auto' ? 'AUTO' : 'TAKEOVER'}
                            </Badge>

                            {/* AI Auto Toggle */}
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id="ai-auto-mode"
                                                checked={botMode === 'auto'}
                                                onCheckedChange={(checked) => handleBotModeToggle(checked ? 'auto' : 'takeover')}
                                                disabled={botModeLoading}
                                            />
                                            <Label
                                                htmlFor="ai-auto-mode"
                                                className={cn(
                                                    "text-xs cursor-pointer flex items-center gap-1",
                                                    botMode === 'auto' ? "text-green-600 font-medium" : "text-gray-500"
                                                )}
                                            >
                                                {botModeLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                                AI Auto
                                            </Label>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{botMode === 'auto' ? 'Bot auto-replies to messages' : 'Bot is silent, admin handling'}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    )}
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

                {/* Messages */}
                <ScrollArea className="flex-1 p-4 bg-gray-50/30">
                    <div className="space-y-4 pb-4">
                        {loadingMessages ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                            </div>
                        ) : (
                            messages.map((msg) => {
                                const isAdmin = msg.sender_type === 'admin'
                                const isSystem = msg.sender_type === 'system'
                                const channel = msg.channel || 'app'
                                const channelConfig = CHANNEL_CONFIG[channel as keyof typeof CHANNEL_CONFIG] || CHANNEL_CONFIG.app
                                const ChannelIcon = channelConfig.icon
                                const isWhatsApp = channel === 'whatsapp'
                                const isAI = channel === 'ai'

                                if (isSystem) {
                                    return (
                                        <div key={msg.id} className="flex justify-center my-4">
                                            <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full">
                                                {msg.body_text}
                                            </span>
                                        </div>
                                    )
                                }

                                return (
                                    <div key={msg.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                                        <div className={cn(
                                            "max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm relative",
                                            isAdmin
                                                ? isWhatsApp
                                                    ? "bg-green-600 text-white rounded-br-none"
                                                    : isAI
                                                        ? "bg-amber-500 text-white rounded-br-none"
                                                        : "bg-blue-600 text-white rounded-br-none"
                                                : isWhatsApp
                                                    ? "bg-green-50 text-gray-900 border border-green-200 rounded-bl-none"
                                                    : "bg-white text-gray-900 border border-gray-100 rounded-bl-none"
                                        )}>
                                            {/* Channel badge */}
                                            {(isWhatsApp || isAI) && (
                                                <div className={cn(
                                                    "flex items-center gap-1 text-[10px] mb-1 font-medium",
                                                    isAdmin ? "text-white/80" : "text-green-600"
                                                )}>
                                                    <ChannelIcon className="w-3 h-3" />
                                                    {isWhatsApp ? 'via WhatsApp' : 'AI Generated'}
                                                </div>
                                            )}

                                            <p className="whitespace-pre-wrap text-sm">{msg.body_text}</p>
                                            {msg.attachments && msg.attachments.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {msg.attachments.map((att: any, i: number) => (
                                                        <a
                                                            key={i}
                                                            href={att.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={cn(
                                                                "flex items-center gap-1 text-xs underline",
                                                                isAdmin ? "text-blue-100" : "text-blue-600"
                                                            )}
                                                        >
                                                            <Paperclip className="w-3 h-3" />
                                                            {att.name || 'Attachment'}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                            <div className={cn(
                                                "text-[10px] mt-1 flex items-center justify-end gap-1",
                                                isAdmin ? "text-blue-100" : "text-gray-400"
                                            )}>
                                                {format(new Date(msg.created_at), 'HH:mm')}
                                                {isAdmin && msg.read_by_user_at && (
                                                    <Eye className="w-3 h-3" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                        <div ref={scrollRef} />
                    </div>
                </ScrollArea>

                {/* Reply Input */}
                <div className="p-4 border-t bg-white">
                    {/* AI Suggestion Panel */}
                    {showAiPanel && (
                        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-amber-700 text-sm font-medium">
                                    <Sparkles className="w-4 h-4" />
                                    AI Suggestion
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-amber-600 hover:text-amber-800"
                                    onClick={() => setShowAiPanel(false)}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                            {aiLoading ? (
                                <div className="flex items-center gap-2 text-amber-600 text-sm py-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating suggestion...
                                </div>
                            ) : aiSuggestion ? (
                                <>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{aiSuggestion}</p>
                                    <Button
                                        size="sm"
                                        className="bg-amber-500 hover:bg-amber-600 text-white"
                                        onClick={useAiSuggestion}
                                    >
                                        <Zap className="w-3 h-3 mr-1" /> Use This Reply
                                    </Button>
                                </>
                            ) : (
                                <p className="text-sm text-gray-500">No suggestion available</p>
                            )}
                        </div>
                    )}

                    {/* WhatsApp Toggle & AI Buttons */}
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-4">
                            {hasWhatsApp && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    id="whatsapp-mode"
                                                    checked={replyViaWhatsApp}
                                                    onCheckedChange={setReplyViaWhatsApp}
                                                />
                                                <Label
                                                    htmlFor="whatsapp-mode"
                                                    className={cn(
                                                        "text-xs cursor-pointer flex items-center gap-1",
                                                        replyViaWhatsApp ? "text-green-600 font-medium" : "text-gray-500"
                                                    )}
                                                >
                                                    <Phone className="w-3 h-3" />
                                                    WhatsApp
                                                </Label>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Send reply via WhatsApp to {(convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {/* AI Draft Button (Moltbot) */}
                            {hasWhatsApp && userPhone && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleGenerateDraft}
                                        disabled={draftLoading}
                                        className="text-blue-600 border-blue-300 hover:bg-blue-50"
                                    >
                                        {draftLoading ? (
                                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                        ) : (
                                            <Bot className="w-3 h-3 mr-1" />
                                        )}
                                        AI Draft
                                    </Button>

                                    {/* Send Draft Button */}
                                    {pendingDraft && (
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={handleSendDraft}
                                            disabled={sending}
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                        >
                                            {sending ? (
                                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                            ) : (
                                                <Send className="w-3 h-3 mr-1" />
                                            )}
                                            Send Draft
                                        </Button>
                                    )}
                                </>
                            )}

                            {/* Original AI Assist Button */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAiAssist}
                                disabled={aiLoading}
                                className="text-amber-600 border-amber-300 hover:bg-amber-50"
                            >
                                {aiLoading ? (
                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                ) : (
                                    <Sparkles className="w-3 h-3 mr-1" />
                                )}
                                AI Assist
                            </Button>
                        </div>
                    </div>

                    <form onSubmit={handleSend} className="flex gap-2">
                        <Textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder={replyViaWhatsApp ? "Type your WhatsApp reply..." : "Type your reply..."}
                            className={cn(
                                "flex-1 resize-none min-h-[60px] max-h-[120px]",
                                replyViaWhatsApp && "border-green-300 focus:border-green-500"
                            )}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSend(e)
                                }
                            }}
                        />
                        <Button
                            type="submit"
                            disabled={!newMessage.trim() || sending}
                            className={cn(
                                "px-6",
                                replyViaWhatsApp && "bg-green-600 hover:bg-green-700"
                            )}
                        >
                            {sending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : replyViaWhatsApp ? (
                                <Phone className="w-4 h-4" />
                            ) : (
                                <Send className="w-4 h-4" />
                            )}
                        </Button>
                    </form>
                    <p className="text-[10px] text-gray-400 mt-1">
                        {replyViaWhatsApp
                            ? 'Message will be sent via WhatsApp and saved in app'
                            : 'Press Enter to send, Shift+Enter for new line'
                        }
                    </p>
                </div>
            </div>

            {/* Right Sidebar - Metadata Panel */}
            <div className="w-80 border-l bg-gray-50/50 flex flex-col overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                    <TabsList className="w-full justify-start rounded-none border-b bg-white px-2">
                        <TabsTrigger value="chat" className="text-xs">Details</TabsTrigger>
                        <TabsTrigger value="notes" className="text-xs">Notes ({notes.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="chat" className="flex-1 overflow-auto m-0 p-4 space-y-4">
                        {/* Status */}
                        <div>
                            <Label className="text-xs text-gray-500 mb-1.5 block">Status</Label>
                            <Select value={convDetails.status} onValueChange={handleStatusChange}>
                                <SelectTrigger className="w-full bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                                        <SelectItem key={key} value={key}>
                                            <div className="flex items-center gap-2">
                                                <config.icon className="w-3.5 h-3.5" />
                                                {config.label}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Priority */}
                        <div>
                            <Label className="text-xs text-gray-500 mb-1.5 block">Priority</Label>
                            <Select value={convDetails.priority} onValueChange={handlePriorityChange}>
                                <SelectTrigger className="w-full bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                                        <SelectItem key={key} value={key}>
                                            <Badge className={cn("text-xs", config.color)}>{config.label}</Badge>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignment */}
                        <div>
                            <Label className="text-xs text-gray-500 mb-1.5 block">Assigned To</Label>
                            <Select
                                value={convDetails.assigned_to?.id || 'unassigned'}
                                onValueChange={(v) => handleAssignChange(v === 'unassigned' ? null : v)}
                            >
                                <SelectTrigger className="w-full bg-white">
                                    <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="unassigned">Unassigned</SelectItem>
                                    {admins.map(admin => (
                                        <SelectItem key={admin.id} value={admin.id}>
                                            {admin.full_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Tags */}
                        <div>
                            <Label className="text-xs text-gray-500 mb-1.5 block">Tags</Label>
                            <div className="flex flex-wrap gap-1">
                                {convDetails.tags && convDetails.tags.length > 0 ? (
                                    convDetails.tags.map(tag => (
                                        <Badge
                                            key={tag.id}
                                            style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                            className="text-xs"
                                        >
                                            {tag.name}
                                        </Badge>
                                    ))
                                ) : (
                                    <span className="text-xs text-gray-400">No tags</span>
                                )}
                            </div>
                        </div>

                        {/* User Info */}
                        <div className="pt-4 border-t">
                            <Label className="text-xs text-gray-500 mb-2 block">User Information</Label>
                            <div className="space-y-2 text-sm">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    <span>{convDetails.created_by?.full_name || 'Unknown'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 text-gray-400" />
                                    <span className="text-blue-600">{convDetails.created_by?.phone || 'No phone'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                    <span>Created {formatDistanceToNow(new Date(convDetails.created_at), { addSuffix: true })}</span>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="notes" className="flex-1 overflow-auto m-0 p-4 flex flex-col">
                        {/* Add Note */}
                        <div className="mb-4">
                            <Textarea
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                placeholder="Add internal note..."
                                className="resize-none min-h-[80px] text-sm"
                            />
                            <Button
                                size="sm"
                                className="mt-2 w-full"
                                onClick={handleAddNote}
                                disabled={!newNote.trim()}
                            >
                                <StickyNote className="w-3.5 h-3.5 mr-1.5" /> Add Note
                            </Button>
                        </div>

                        {/* Notes List */}
                        <div className="flex-1 space-y-3">
                            {notes.length === 0 ? (
                                <p className="text-xs text-gray-400 text-center py-4">No internal notes yet</p>
                            ) : (
                                notes.map(note => (
                                    <div key={note.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.note_text}</p>
                                        <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
                                            <span>{note.admin?.full_name || 'Admin'}</span>
                                            <span>{format(new Date(note.created_at), 'MMM d, HH:mm')}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}

// Blast Announcement Modal
function BlastAnnouncementModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [message, setMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [targetType, setTargetType] = useState<'all' | 'state' | 'role'>('all')
    const [selectedStates, setSelectedStates] = useState<string[]>([])
    const [selectedRoles, setSelectedRoles] = useState<string[]>([])
    const [states, setStates] = useState<{ id: string; state_name: string; state_code: string }[]>([])
    const [loadingStates, setLoadingStates] = useState(false)
    const [previewCount, setPreviewCount] = useState<number | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)

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

    const roleOptions = [
        { value: 'consumer', label: 'Consumers' },
        { value: 'shop', label: 'Shop Owners' },
        { value: 'SA', label: 'Sales Agents' },
        { value: 'HQ', label: 'HQ Staff' }
    ]

    useEffect(() => {
        if (open) {
            fetchStates()
        }
    }, [open])

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
            if (data.states) setStates(data.states)
        } catch (error) {
            console.error('Failed to fetch states', error)
        } finally {
            setLoadingStates(false)
        }
    }

    const fetchPreviewCount = async () => {
        setLoadingPreview(true)
        try {
            const res = await fetch('/api/admin/support/blast/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetType,
                    states: targetType === 'state' ? selectedStates : [],
                    roles: targetType === 'role' ? selectedRoles : []
                })
            })
            const data = await res.json()
            setPreviewCount(data.count ?? null)
        } catch (error) {
            console.error('Failed to fetch preview', error)
        } finally {
            setLoadingPreview(false)
        }
    }

    const handleSend = async () => {
        if (!message.trim()) return

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

                            if (data.type === 'error') {
                                setProgress(p => ({ ...p, status: 'error', message: data.error }))
                            } else if (data.type === 'start') {
                                setProgress(p => ({ ...p, total: data.total, message: data.message }))
                            } else if (data.type === 'progress') {
                                setProgress({
                                    status: 'sending',
                                    total: data.total,
                                    sent: data.sent,
                                    failed: data.failed,
                                    percent: data.percent,
                                    message: data.message
                                })
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
                            }
                        } catch (e) {
                            console.error('Parse error:', e)
                        }
                    }
                }
            }
        } catch (error: any) {
            setProgress(p => ({
                ...p,
                status: 'error',
                message: error.message || 'Failed to send blast'
            }))
        } finally {
            setSending(false)
        }
    }

    const handleClose = () => {
        if (!sending) {
            setMessage('')
            setProgress({ status: 'idle', total: 0, sent: 0, failed: 0, percent: 0, message: '' })
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Megaphone className="w-5 h-5 text-purple-600" />
                        Blast Announcement
                    </DialogTitle>
                    <DialogDescription>
                        Send a message to all users or a specific segment. Messages will appear in their Support Inbox.
                    </DialogDescription>
                </DialogHeader>

                {progress.status === 'idle' ? (
                    <div className="space-y-4">
                        {/* Target Type */}
                        <div>
                            <Label>Target Audience</Label>
                            <div className="flex gap-2 mt-1.5">
                                <Button
                                    variant={targetType === 'all' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setTargetType('all')}
                                >
                                    All Users
                                </Button>
                                <Button
                                    variant={targetType === 'state' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setTargetType('state')}
                                >
                                    By State
                                </Button>
                                <Button
                                    variant={targetType === 'role' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setTargetType('role')}
                                >
                                    By Role
                                </Button>
                            </div>
                        </div>

                        {/* State Selection */}
                        {targetType === 'state' && (
                            <div>
                                <Label>Select States</Label>
                                <div className="flex flex-wrap gap-2 mt-1.5 max-h-32 overflow-auto p-2 border rounded-md">
                                    {loadingStates ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        states.map(state => (
                                            <label key={state.id} className="flex items-center gap-1.5 text-sm">
                                                <Checkbox
                                                    checked={selectedStates.includes(state.state_code)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setSelectedStates([...selectedStates, state.state_code])
                                                        } else {
                                                            setSelectedStates(selectedStates.filter(s => s !== state.state_code))
                                                        }
                                                    }}
                                                />
                                                {state.state_name}
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Role Selection */}
                        {targetType === 'role' && (
                            <div>
                                <Label>Select Roles</Label>
                                <div className="flex flex-wrap gap-2 mt-1.5">
                                    {roleOptions.map(role => (
                                        <label key={role.value} className="flex items-center gap-1.5 text-sm">
                                            <Checkbox
                                                checked={selectedRoles.includes(role.value)}
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        setSelectedRoles([...selectedRoles, role.value])
                                                    } else {
                                                        setSelectedRoles(selectedRoles.filter(r => r !== role.value))
                                                    }
                                                }}
                                            />
                                            {role.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Message */}
                        <div>
                            <Label>Message</Label>
                            <Textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Type your announcement message..."
                                className="mt-1.5 min-h-[120px]"
                            />
                        </div>

                        {/* Preview Count */}
                        {previewCount !== null && (
                            <div className="text-sm text-gray-600 bg-gray-50 rounded-md p-2 flex items-center gap-2">
                                <Users className="w-4 h-4" />
                                This message will be sent to <strong>{previewCount.toLocaleString()}</strong> users
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        {/* Progress Bar */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>{progress.message}</span>
                                <span>{progress.percent}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                                <div
                                    className={cn(
                                        "h-3 rounded-full transition-all duration-300",
                                        progress.status === 'error' ? 'bg-red-500' :
                                            progress.status === 'complete' ? 'bg-green-500' : 'bg-blue-500'
                                    )}
                                    style={{ width: `${progress.percent}%` }}
                                />
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-2xl font-bold text-gray-900">{progress.total}</div>
                                <div className="text-xs text-gray-500">Total</div>
                            </div>
                            <div className="bg-green-50 rounded-lg p-3">
                                <div className="text-2xl font-bold text-green-600">{progress.sent}</div>
                                <div className="text-xs text-gray-500">Sent</div>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3">
                                <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
                                <div className="text-xs text-gray-500">Failed</div>
                            </div>
                        </div>

                        {/* Errors */}
                        {progress.errors && progress.errors.length > 0 && (
                            <div className="bg-red-50 border border-red-100 rounded-md p-3">
                                <p className="text-sm font-medium text-red-800 mb-1">Some errors occurred:</p>
                                <ul className="text-xs text-red-600 list-disc list-inside">
                                    {progress.errors.slice(0, 3).map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {progress.status === 'idle' ? (
                        <>
                            <Button variant="outline" onClick={handleClose}>Cancel</Button>
                            <Button
                                onClick={handleSend}
                                disabled={!message.trim() || sending}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                                Send Blast
                            </Button>
                        </>
                    ) : progress.status === 'complete' || progress.status === 'error' ? (
                        <Button onClick={handleClose}>Close</Button>
                    ) : (
                        <Button disabled>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Sending...
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default AdminSupportInboxV2
