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
    Globe,
    PanelRightClose,
    PanelRightOpen
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
    // Two-column layout - always show list + detail side by side
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
    const [loading, setLoading] = useState(false)
    const [showBlastModal, setShowBlastModal] = useState(false)
    const [showSidebar, setShowSidebar] = useState(false) // Collapsible drawer state - hidden by default

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
        <div className="h-[calc(100vh-120px)] flex bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* LEFT PANEL - Conversation List */}
            <div className="w-[380px] min-w-[320px] border-r border-gray-200 flex flex-col bg-white h-full">
                {/* Header */}
                <div className="px-4 py-3 border-b border-gray-100 bg-white">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-semibold text-gray-900">Inbox</h2>
                        <div className="flex items-center gap-2">
                            <Button onClick={fetchConversations} variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                            </Button>
                            <Button onClick={() => setShowBlastModal(true)} variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <Megaphone className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search conversations..."
                            className="pl-9 h-9 bg-gray-50 border-gray-200 text-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-2 py-2 border-b border-gray-100 flex items-center gap-1 bg-gray-50/50">
                    <Button
                        variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs rounded-full"
                        onClick={() => { setStatusFilter('all'); setCurrentPage(1) }}
                    >
                        All
                    </Button>
                    <Button
                        variant={statusFilter === 'open' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs rounded-full"
                        onClick={() => { setStatusFilter('open'); setCurrentPage(1) }}
                    >
                        Open
                    </Button>
                    <Button
                        variant={statusFilter === 'pending_admin' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs rounded-full"
                        onClick={() => { setStatusFilter('pending_admin'); setCurrentPage(1) }}
                    >
                        Pending
                    </Button>
                    <Button
                        variant={statusFilter === 'resolved' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs rounded-full"
                        onClick={() => { setStatusFilter('resolved'); setCurrentPage(1) }}
                    >
                        Resolved
                    </Button>
                </div>

                {/* Conversation List - Scrollable container */}
                <ScrollArea className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mb-2" />
                            <span className="text-sm text-gray-500">Loading...</span>
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                                <MessageSquare className="w-6 h-6 text-gray-400" />
                            </div>
                            <p className="text-sm font-medium text-gray-600 mb-1">No conversations</p>
                            <p className="text-xs text-gray-400">Conversations will appear here</p>
                        </div>
                    ) : (
                        <div>
                            {conversations.map((conv) => (
                                <ConversationListItem
                                    key={conv.id}
                                    conversation={conv}
                                    isActive={activeConversation?.id === conv.id}
                                    onClick={() => handleConversationClick(conv)}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {/* Pagination */}
                {!loading && conversations.length > 0 && (
                    <div className="px-3 py-2 border-t border-gray-100 bg-white flex items-center justify-between">
                        <span className="text-[11px] text-gray-400">
                            {(currentPage - 1) * rowsPerPage + 1}–{Math.min(currentPage * rowsPerPage, totalCount)} of {totalCount}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-6 px-2 text-[10px]">
                                ←
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="h-6 px-2 text-[10px]">
                                →
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* RIGHT PANEL - Chat Detail */}
            <div className="flex-1 flex flex-col bg-gray-50/30 h-full overflow-hidden">
                {activeConversation ? (
                    <ConversationDetailView
                        conversation={activeConversation}
                        admins={admins}
                        tags={tags}
                        onBack={() => setActiveConversation(null)}
                        onUpdate={fetchConversations}
                        showSidebar={showSidebar}
                        setShowSidebar={setShowSidebar}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                        <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                            <MessageSquare className="w-10 h-10 text-gray-300" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-600 mb-2">Select a conversation</h3>
                        <p className="text-sm text-gray-400 max-w-sm">
                            Choose a conversation from the list to view messages and respond to customers
                        </p>
                    </div>
                )}
            </div>

            <BlastAnnouncementModal open={showBlastModal} onOpenChange={setShowBlastModal} />
        </div>
    )
}

// NEW: Compact Conversation List Item for two-column layout
function ConversationListItem({
    conversation,
    isActive,
    onClick
}: {
    conversation: Conversation & { primary_channel?: string; whatsapp_user_phone?: string }
    isActive: boolean
    onClick: () => void
}) {
    const isWhatsApp = conversation.primary_channel === 'whatsapp' || !!conversation.whatsapp_user_phone
    const hasUnread = conversation.admin_unread_count > 0

    return (
        <div
            onClick={onClick}
            className={cn(
                "px-3 py-3 cursor-pointer transition-all border-l-3",
                isActive
                    ? "bg-blue-50 border-l-blue-500"
                    : hasUnread
                        ? "bg-blue-50/50 border-l-transparent hover:bg-gray-50"
                        : "border-l-transparent hover:bg-gray-50",
                isWhatsApp && !isActive && "border-l-green-400"
            )}
        >
            <div className="flex items-start gap-3">
                {/* Avatar with unread badge */}
                <div className="relative flex-shrink-0">
                    <div className={cn(
                        "w-11 h-11 rounded-full flex items-center justify-center text-sm font-medium",
                        hasUnread ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    )}>
                        {conversation.created_by?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    {isWhatsApp && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                            <Phone className="w-2.5 h-2.5 text-white" />
                        </div>
                    )}
                    {hasUnread && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] text-white font-bold">
                            {conversation.admin_unread_count > 9 ? '9+' : conversation.admin_unread_count}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                        <span className={cn(
                            "text-sm truncate max-w-[160px]",
                            hasUnread ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                        )}>
                            {conversation.created_by?.full_name || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {format(new Date(conversation.last_message_at), 'MMM d, HH:mm')}
                        </span>
                    </div>
                    <p className={cn(
                        "text-xs truncate mb-1",
                        hasUnread ? "text-gray-700" : "text-gray-500"
                    )}>
                        {conversation.subject}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                        {conversation.last_message_sender_type === 'admin' && 'You: '}
                        {conversation.last_message_preview || 'No messages'}
                    </p>
                </div>
            </div>
        </div>
    )
}

// OLD Conversation Row Component (keeping for compatibility but not used in new layout)
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
                "px-4 py-3 hover:bg-gray-50 cursor-pointer transition-all border-b border-gray-100",
                conversation.is_unread && "bg-blue-50/40",
                isWhatsAppConversation && "border-l-2 border-l-green-500"
            )}
        >
            <div className="flex items-start gap-3">
                {/* Unread indicator / Avatar placeholder */}
                <div className={cn(
                    "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium",
                    conversation.is_unread
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                )}>
                    {conversation.admin_unread_count > 0 ? (
                        <span className="font-bold">{conversation.admin_unread_count}</span>
                    ) : (
                        <User className="w-4 h-4" />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    {/* Header row - prioritize customer name and case */}
                    <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2">
                            <h4 className={cn(
                                "text-sm truncate max-w-[180px]",
                                conversation.is_unread ? "text-gray-900 font-semibold" : "text-gray-700 font-medium"
                            )}>
                                {conversation.created_by?.full_name || 'Unknown User'}
                            </h4>
                            {isWhatsAppConversation && (
                                <Phone className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                            )}
                        </div>
                        <span className="text-[11px] text-gray-400 whitespace-nowrap">
                            {format(new Date(conversation.last_message_at), 'MMM d, HH:mm')}
                        </span>
                    </div>

                    {/* Subject line */}
                    <p className={cn(
                        "text-sm truncate mb-1",
                        conversation.is_unread ? "text-gray-800" : "text-gray-600"
                    )}>
                        {conversation.subject}
                    </p>

                    {/* Preview - muted */}
                    <p className="text-xs text-gray-400 truncate mb-1.5">
                        {conversation.last_message_sender_type === 'admin' && (
                            <span className="text-gray-500">You: </span>
                        )}
                        {conversation.last_message_preview || 'No messages'}
                    </p>

                    {/* Meta row - minimal badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono text-gray-400 border-gray-200">
                            {conversation.case_number}
                        </Badge>
                        <Badge className={cn("text-[10px] h-5 px-1.5", statusConfig.color)}>
                            {statusConfig.label}
                        </Badge>
                        {conversation.priority !== 'normal' && (
                            <Badge className={cn("text-[10px] h-5 px-1.5", priorityConfig.color)}>
                                {priorityConfig.label}
                            </Badge>
                        )}
                        {conversation.assigned_to && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <UserPlus className="w-3 h-3" />
                                {conversation.assigned_to.full_name}
                            </span>
                        )}
                        {conversation.tags && conversation.tags.length > 0 && (
                            <div className="flex items-center gap-1">
                                {conversation.tags.slice(0, 2).map(tag => (
                                    <span
                                        key={tag.id}
                                        className="px-1.5 py-0.5 rounded text-[9px]"
                                        style={{ backgroundColor: tag.color + '15', color: tag.color }}
                                    >
                                        {tag.name}
                                    </span>
                                ))}
                                {conversation.tags.length > 2 && (
                                    <span className="text-[9px] text-gray-400">+{conversation.tags.length - 2}</span>
                                )}
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
    onUpdate,
    showSidebar,
    setShowSidebar
}: {
    conversation: Conversation
    admins: Admin[]
    tags: Tag[]
    onBack: () => void
    onUpdate: () => void
    showSidebar: boolean
    setShowSidebar: (show: boolean) => void
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

    // AI is enabled only when botMode is 'auto' - hide ALL AI UI when 'takeover'
    const isAiEnabled = botMode === 'auto'

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
        <div className="flex h-full overflow-hidden">
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {/* Header - Professional, clean design for two-column layout */}
                <div className="px-4 py-3 border-b flex items-center justify-between bg-white">
                    <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                            {convDetails.created_by?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-gray-900">{convDetails.created_by?.full_name || 'Unknown'}</h3>
                                {hasWhatsApp && (
                                    <Badge className="h-5 px-1.5 bg-green-50 text-green-700 border border-green-200 text-[10px]">
                                        <Phone className="w-3 h-3 mr-0.5" />
                                        WhatsApp
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>{convDetails.subject}</span>
                                <span className="text-gray-300">•</span>
                                <span className="font-mono text-gray-400">{convDetails.case_number}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right side controls - Only show AI controls when AI is enabled */}
                    <div className="flex items-center gap-3">
                        {/* Manual Mode indicator with toggle to enable AI - shown when AI is OFF */}
                        {hasWhatsApp && userPhone && !isAiEnabled && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id="ai-auto-mode-off"
                                                checked={false}
                                                onCheckedChange={(checked) => handleBotModeToggle(checked ? 'auto' : 'takeover')}
                                                disabled={botModeLoading}
                                            />
                                            <Label
                                                htmlFor="ai-auto-mode-off"
                                                className="text-xs cursor-pointer flex items-center gap-1.5 text-gray-400"
                                            >
                                                {botModeLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                                <User className="w-3.5 h-3.5" />
                                                Manual
                                            </Label>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>AI is off. Toggle to enable auto-reply.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}

                        {/* AI Bot Mode Controls - ONLY show when AI is enabled */}
                        {hasWhatsApp && userPhone && isAiEnabled && (
                            <>
                                {/* Mode Badge */}
                                <Badge className="text-xs font-medium bg-green-100 text-green-700 hover:bg-green-100">
                                    <Bot className="w-3 h-3 mr-1" />
                                    AUTO
                                </Badge>

                                {/* AI Auto Toggle */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    id="ai-auto-mode"
                                                    checked={true}
                                                    onCheckedChange={(checked) => handleBotModeToggle(checked ? 'auto' : 'takeover')}
                                                    disabled={botModeLoading}
                                                />
                                                <Label
                                                    htmlFor="ai-auto-mode"
                                                    className="text-xs cursor-pointer flex items-center gap-1 text-green-600 font-medium"
                                                >
                                                    {botModeLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                                    AI Auto
                                                </Label>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Bot auto-replies to messages</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </>
                        )}

                        {/* Sidebar Toggle Button */}
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={() => setShowSidebar(!showSidebar)}
                                    >
                                        {showSidebar ? (
                                            <PanelRightClose className="w-4 h-4 text-gray-500" />
                                        ) : (
                                            <PanelRightOpen className="w-4 h-4 text-gray-500" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{showSidebar ? 'Hide Details' : 'Show Details'}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
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

                {/* Messages - Scrollable area */}
                <ScrollArea className="flex-1 p-4 bg-gray-50/30 overflow-y-auto">
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
                                const isAIMessage = channel === 'ai'

                                if (isSystem) {
                                    return (
                                        <div key={msg.id} className="flex justify-center my-4">
                                            <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1.5 rounded-full">
                                                {msg.body_text}
                                            </span>
                                        </div>
                                    )
                                }

                                return (
                                    <div key={msg.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                                        <div className={cn(
                                            "max-w-[70%] rounded-2xl px-4 py-3 shadow-sm relative",
                                            isAdmin
                                                // Admin messages - WhatsApp style outgoing (teal/green)
                                                ? "bg-emerald-500 text-white rounded-br-sm"
                                                // User messages - WhatsApp style incoming (light green)
                                                : "bg-green-100 text-gray-900 rounded-bl-sm"
                                        )}>
                                            {/* Channel badge - only show WhatsApp indicator, hide AI badge when AI is off */}
                                            {isWhatsApp && (
                                                <div className={cn(
                                                    "flex items-center gap-1 text-[10px] mb-1.5 font-medium",
                                                    isAdmin ? "text-white/80" : "text-green-600"
                                                )}>
                                                    <Phone className="w-3 h-3" />
                                                    via WhatsApp
                                                </div>
                                            )}
                                            {/* Only show AI Generated badge if AI mode is enabled */}
                                            {isAIMessage && isAiEnabled && (
                                                <div className={cn(
                                                    "flex items-center gap-1 text-[10px] mb-1.5 font-medium",
                                                    isAdmin ? "text-white/80" : "text-amber-600"
                                                )}>
                                                    <Bot className="w-3 h-3" />
                                                    AI Generated
                                                </div>
                                            )}

                                            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body_text}</p>
                                            {msg.attachments && msg.attachments.length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-white/20 space-y-1">
                                                    {msg.attachments.map((att: any, i: number) => (
                                                        <a
                                                            key={i}
                                                            href={att.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={cn(
                                                                "flex items-center gap-1.5 text-xs hover:underline",
                                                                isAdmin ? "text-white/90" : "text-blue-600"
                                                            )}
                                                        >
                                                            <Paperclip className="w-3 h-3" />
                                                            {att.name || 'Attachment'}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                            <div className={cn(
                                                "text-[10px] mt-2 flex items-center justify-end gap-1.5",
                                                isAdmin ? "text-white/60" : "text-gray-400"
                                            )}>
                                                {format(new Date(msg.created_at), 'HH:mm')}
                                                {isAdmin && msg.read_by_user_at && (
                                                    <CheckCircle2 className="w-3 h-3" />
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
                <div className="p-4 border-t bg-gray-50/50">
                    {/* AI Suggestion Panel - ONLY show when AI is enabled */}
                    {isAiEnabled && showAiPanel && (
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

                    {/* WhatsApp Toggle & AI Buttons - AI buttons ONLY show when AI is enabled */}
                    <div className="flex items-center justify-between mb-3">
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
                                                    className="data-[state=checked]:bg-green-600"
                                                />
                                                <Label
                                                    htmlFor="whatsapp-mode"
                                                    className={cn(
                                                        "text-xs cursor-pointer flex items-center gap-1.5",
                                                        replyViaWhatsApp ? "text-green-600 font-medium" : "text-gray-500"
                                                    )}
                                                >
                                                    <Phone className="w-3.5 h-3.5" />
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

                        {/* AI Buttons - ONLY show when AI is enabled */}
                        {isAiEnabled && (
                            <div className="flex items-center gap-2">
                                {/* AI Draft Button (Moltbot) */}
                                {hasWhatsApp && userPhone && (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleGenerateDraft}
                                            disabled={draftLoading}
                                            className="text-blue-600 border-blue-200 hover:bg-blue-50 h-8"
                                        >
                                            {draftLoading ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                            ) : (
                                                <Bot className="w-3.5 h-3.5 mr-1.5" />
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
                                                className="bg-green-600 hover:bg-green-700 text-white h-8"
                                            >
                                                {sending ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                                ) : (
                                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                                )}
                                                Send Draft
                                            </Button>
                                        )}
                                    </>
                                )}

                                {/* AI Assist Button */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleAiAssist}
                                    disabled={aiLoading}
                                    className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8"
                                >
                                    {aiLoading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                    ) : (
                                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                    )}
                                    AI Assist
                                </Button>
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSend} className="flex gap-2">
                        <Textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder={replyViaWhatsApp ? "Type your WhatsApp reply..." : "Type your reply..."}
                            className={cn(
                                "flex-1 resize-none min-h-[56px] max-h-[120px] bg-white text-sm",
                                replyViaWhatsApp && "border-green-300 focus:border-green-500 focus:ring-green-500/20"
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
                                "px-5 h-auto min-h-[56px] font-medium",
                                replyViaWhatsApp
                                    ? "bg-green-600 hover:bg-green-700"
                                    : "bg-slate-700 hover:bg-slate-800"
                            )}
                        >
                            {sending ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <Send className="w-5 h-5" />
                            )}
                        </Button>
                    </form>
                    <p className="text-[10px] text-gray-400 mt-2">
                        {replyViaWhatsApp
                            ? 'Message will be sent via WhatsApp'
                            : 'Press Enter to send, Shift+Enter for new line'
                        }
                    </p>
                </div>
            </div>

            {/* Right Sidebar - Collapsible Drawer */}
            <div className={cn(
                "border-l bg-gray-50/50 flex flex-col overflow-hidden transition-all duration-300 ease-in-out",
                showSidebar ? "w-80 opacity-100" : "w-0 opacity-0"
            )}>
                {showSidebar && (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full w-80">
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
                )}
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
