'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
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
    Megaphone,
    Loader2,
    User,
    X,
    StickyNote,
    Clock,
    CheckCircle2,
    AlertCircle,
    MoreHorizontal,
    Archive,
    Inbox,
    Users,
    AlertTriangle,
    MessageCircle,
    Paperclip,
    Phone,
    Smartphone,
    Bot,
    Sparkles,
    Zap,
    Globe,
    PanelRightClose,
    PanelRightOpen,
    ChevronLeft,
    ChevronRight,
    MailOpen
} from 'lucide-react'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ─── Types ─────────────────────────────────────────────────
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
    primary_channel?: string
    whatsapp_user_phone?: string
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

// ─── Config ────────────────────────────────────────────────
const CHANNEL_CONFIG = {
    app: { label: 'App', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: Smartphone },
    whatsapp: { label: 'WhatsApp', color: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: Phone },
    admin_web: { label: 'Web', color: 'bg-violet-50 text-violet-600 border-violet-200', icon: Globe },
    ai: { label: 'AI Bot', color: 'bg-amber-50 text-amber-600 border-amber-200', icon: Bot }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string; icon: any }> = {
    open: { label: 'Open', color: 'bg-sky-50 text-sky-700 border-sky-200', dotColor: 'bg-sky-500', icon: Inbox },
    pending_user: { label: 'Awaiting User', color: 'bg-amber-50 text-amber-700 border-amber-200', dotColor: 'bg-amber-500', icon: Clock },
    pending_admin: { label: 'Needs Reply', color: 'bg-orange-50 text-orange-700 border-orange-200', dotColor: 'bg-orange-500', icon: AlertCircle },
    resolved: { label: 'Resolved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotColor: 'bg-emerald-500', icon: CheckCircle2 },
    closed: { label: 'Closed', color: 'bg-slate-100 text-slate-600 border-slate-200', dotColor: 'bg-slate-400', icon: Archive },
    spam: { label: 'Spam', color: 'bg-red-50 text-red-700 border-red-200', dotColor: 'bg-red-500', icon: AlertTriangle }
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
    low: { label: 'Low', color: 'text-slate-500', dot: 'bg-slate-300' },
    normal: { label: 'Normal', color: 'text-blue-500', dot: 'bg-blue-400' },
    high: { label: 'High', color: 'text-orange-500', dot: 'bg-orange-400' },
    urgent: { label: 'Urgent', color: 'text-red-600', dot: 'bg-red-500' }
}

// ─── Helpers ───────────────────────────────────────────────
function smartDate(dateStr: string): string {
    const d = new Date(dateStr)
    if (isToday(d)) return format(d, 'HH:mm')
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'MMM d')
}

function getInitials(name: string): string {
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'
}

const AVATAR_COLORS = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-violet-500 to-purple-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-cyan-500 to-sky-600',
]

function avatarColor(name: string): string {
    const hash = (name || 'U').charCodeAt(0) + (name || 'U').length
    return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function formatDateDivider(dateStr: string): string {
    const d = new Date(dateStr)
    if (isToday(d)) return 'Today'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'EEEE, MMMM d')
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export function AdminSupportInboxV2() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
    const [loading, setLoading] = useState(false)
    const [showBlastModal, setShowBlastModal] = useState(false)
    const [showSidebar, setShowSidebar] = useState(false)

    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')
    const [assignedFilter, setAssignedFilter] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')

    const [currentPage, setCurrentPage] = useState(1)
    const [rowsPerPage] = useState(20)
    const [totalCount, setTotalCount] = useState(0)

    const [admins, setAdmins] = useState<Admin[]>([])
    const [tags, setTags] = useState<Tag[]>([])

    const [globalAiEnabled, setGlobalAiEnabled] = useState(true)
    const [inboxWhatsAppEnabled, setInboxWhatsAppEnabled] = useState(false)

    const totalPages = Math.ceil(totalCount / rowsPerPage)

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

    const fetchAdmins = async () => {
        try {
            const res = await fetch('/api/admin/support/admins')
            const data = await res.json()
            if (data.admins) setAdmins(data.admins)
        } catch (error) { console.error('Failed to fetch admins', error) }
    }

    const fetchTags = async () => {
        try {
            const res = await fetch('/api/admin/support/tags')
            const data = await res.json()
            if (data.tags) setTags(data.tags)
        } catch (error) { console.error('Failed to fetch tags', error) }
    }

    const fetchGlobalSettings = async () => {
        try {
            const aiRes = await fetch('/api/admin/whatsapp/ai-mode')
            const aiData = await aiRes.json()
            if (aiData.ok) setGlobalAiEnabled(aiData.mode === 'auto')
            const waRes = await fetch('/api/admin/whatsapp/config')
            if (waRes.ok) {
                const waData = await waRes.json()
                setInboxWhatsAppEnabled(waData.config?.config_public?.inbox_reply_via_whatsapp === true)
            }
        } catch (err) { console.error('Failed to fetch global settings:', err) }
    }

    useEffect(() => {
        fetchConversations()
        fetchAdmins()
        fetchTags()
        fetchGlobalSettings()
        const supabase = createClient()
        const channel = supabase
            .channel('admin_inbox_updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => fetchConversations())
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [fetchConversations])

    const handleSearch = () => { setCurrentPage(1); fetchConversations() }

    const filterTabs = [
        { key: 'all', label: 'All' },
        { key: 'open', label: 'Open' },
        { key: 'pending_admin', label: 'Needs Reply' },
        { key: 'resolved', label: 'Resolved' },
    ]

    return (
        <div className="h-[calc(100vh-100px)] flex bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            {/* LEFT: Conversation List */}
            <div className="w-[360px] min-w-[340px] border-r border-slate-200/80 flex flex-col bg-white h-full">
                {/* Header */}
                <div className="px-5 pt-5 pb-3">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                <Inbox className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-slate-900 leading-tight">Inbox</h2>
                                <p className="text-[11px] text-slate-400">{totalCount} conversations</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button onClick={fetchConversations} variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
                                            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"><p className="text-xs">Refresh</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button onClick={() => setShowBlastModal(true)} variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-purple-600">
                                            <Megaphone className="w-3.5 h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"><p className="text-xs">Broadcast</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                            placeholder="Search conversations..."
                            className="pl-9 h-9 bg-slate-50/80 border-slate-200 text-sm rounded-lg"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-3 pb-2 flex items-center gap-1 border-b border-slate-100">
                    {filterTabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => { setStatusFilter(tab.key); setCurrentPage(1) }}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                statusFilter === tab.key ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* List */}
                <ScrollArea className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <Loader2 className="w-5 h-5 animate-spin text-indigo-400 mb-2" />
                            <span className="text-xs text-slate-400">Loading...</span>
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                                <MailOpen className="w-7 h-7 text-slate-300" />
                            </div>
                            <p className="text-sm font-medium text-slate-500 mb-1">No conversations</p>
                            <p className="text-xs text-slate-400">New messages will appear here</p>
                        </div>
                    ) : (
                        <div className="py-1">
                            {conversations.map((conv) => (
                                <ConversationListItem
                                    key={conv.id}
                                    conversation={conv}
                                    isActive={activeConversation?.id === conv.id}
                                    onClick={() => setActiveConversation(conv)}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {/* Pagination */}
                {!loading && conversations.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400 tabular-nums">
                            {(currentPage - 1) * rowsPerPage + 1}–{Math.min(currentPage * rowsPerPage, totalCount)} of {totalCount}
                        </span>
                        <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-7 w-7 p-0">
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </Button>
                            <span className="text-[11px] text-slate-500 tabular-nums px-1">{currentPage}/{totalPages || 1}</span>
                            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="h-7 w-7 p-0">
                                <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* RIGHT: Chat Detail */}
            <div className="flex-1 flex flex-col bg-slate-50/30 h-full overflow-hidden">
                {activeConversation ? (
                    <ConversationDetailView
                        conversation={activeConversation}
                        admins={admins}
                        tags={tags}
                        onBack={() => setActiveConversation(null)}
                        onUpdate={fetchConversations}
                        showSidebar={showSidebar}
                        setShowSidebar={setShowSidebar}
                        globalAiEnabled={globalAiEnabled}
                        inboxWhatsAppEnabled={inboxWhatsAppEnabled}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center mb-5 shadow-inner">
                            <MessageSquare className="w-10 h-10 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-600 mb-1.5">Select a conversation</h3>
                        <p className="text-sm text-slate-400 max-w-xs">Choose a conversation from the list to view messages and respond</p>
                    </div>
                )}
            </div>

            <BlastAnnouncementModal open={showBlastModal} onOpenChange={setShowBlastModal} />
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// CONVERSATION LIST ITEM — modern compact card
// ═══════════════════════════════════════════════════════════
function ConversationListItem({ conversation, isActive, onClick }: { conversation: Conversation; isActive: boolean; onClick: () => void }) {
    const isWhatsApp = conversation.primary_channel === 'whatsapp' || !!conversation.whatsapp_user_phone
    const hasUnread = conversation.admin_unread_count > 0
    const name = conversation.created_by?.full_name || 'Unknown'
    const priorityCfg = PRIORITY_CONFIG[conversation.priority]

    return (
        <div
            onClick={onClick}
            className={cn(
                "mx-2 my-0.5 px-3 py-3 cursor-pointer transition-all rounded-xl group",
                isActive
                    ? "bg-indigo-50/80 ring-1 ring-indigo-200/60"
                    : hasUnread
                        ? "bg-blue-50/30 hover:bg-slate-50"
                        : "hover:bg-slate-50"
            )}
        >
            <div className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-xs font-semibold text-white bg-gradient-to-br",
                        isActive ? 'from-indigo-500 to-indigo-600' : avatarColor(name)
                    )}>
                        {getInitials(name)}
                    </div>
                    {isWhatsApp && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white flex items-center justify-center">
                            <Phone className="w-2 h-2 text-white" />
                        </div>
                    )}
                    {hasUnread && (
                        <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold px-1">
                            {conversation.admin_unread_count > 99 ? '99+' : conversation.admin_unread_count}
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                        <span className={cn("text-[13px] truncate max-w-[160px]", hasUnread ? "font-semibold text-slate-900" : "font-medium text-slate-700")}>{name}</span>
                        <span className="text-[10px] text-slate-400 flex-shrink-0 tabular-nums">{smartDate(conversation.last_message_at)}</span>
                    </div>
                    <p className={cn("text-xs truncate mb-1", hasUnread ? "text-slate-700 font-medium" : "text-slate-500")}>{conversation.subject}</p>
                    <div className="flex items-center gap-1.5">
                        <p className="text-[11px] text-slate-400 truncate flex-1">
                            {conversation.last_message_sender_type === 'admin' && <span className="text-indigo-500">You: </span>}
                            {conversation.last_message_preview || 'No messages yet'}
                        </p>
                        {conversation.priority !== 'normal' && <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", priorityCfg.dot)} />}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// CONVERSATION DETAIL VIEW — modern chat interface
// ═══════════════════════════════════════════════════════════
function ConversationDetailView({
    conversation, admins, tags, onBack, onUpdate, showSidebar, setShowSidebar, globalAiEnabled, inboxWhatsAppEnabled
}: {
    conversation: Conversation; admins: Admin[]; tags: Tag[]; onBack: () => void; onUpdate: () => void
    showSidebar: boolean; setShowSidebar: (show: boolean) => void; globalAiEnabled: boolean; inboxWhatsAppEnabled: boolean
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
    const [sendingWhatsApp, setSendingWhatsApp] = useState(false)

    // AI
    const [aiLoading, setAiLoading] = useState(false)
    const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
    const [showAiPanel, setShowAiPanel] = useState(false)
    const [botMode, setBotMode] = useState<'auto' | 'takeover'>('auto')
    const [botModeLoading, setBotModeLoading] = useState(false)
    const [pendingDraft, setPendingDraft] = useState<string | null>(null)
    const [draftLoading, setDraftLoading] = useState(false)

    const hasWhatsApp = !!(convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone
    const userPhone = (convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone
    const isAiEnabled = botMode === 'auto' && globalAiEnabled
    const replyViaWhatsApp = inboxWhatsAppEnabled && hasWhatsApp

    const fetchBotMode = async () => {
        if (!userPhone) return
        try {
            const res = await fetch(`/api/support/bot/mode/${encodeURIComponent(userPhone)}`)
            if (res.ok) { const data = await res.json(); if (data.ok) { setBotMode(data.mode || 'auto'); setPendingDraft(data.draftPreview || null) } }
        } catch (error) { console.error('Failed to fetch bot mode', error) }
    }

    const handleBotModeToggle = async (newMode: 'auto' | 'takeover') => {
        if (!userPhone || botModeLoading) return
        setBotModeLoading(true)
        try {
            const res = await fetch(`/api/support/bot/mode/${encodeURIComponent(userPhone)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: newMode }) })
            if (res.ok) { const data = await res.json(); setBotMode(data.mode || newMode) }
        } catch (error) { console.error('Failed to update bot mode', error) }
        finally { setBotModeLoading(false) }
    }

    const handleGenerateDraft = async () => {
        if (!userPhone || draftLoading) return
        setDraftLoading(true); setError(null)
        try {
            const res = await fetch(`/api/support/bot/draft/${encodeURIComponent(userPhone)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: '' }) })
            const data = await res.json()
            if (data.ok && data.draft) { setPendingDraft(data.draft); setShowAiPanel(true); setAiSuggestion(data.draft) }
            else setError(data.error || 'Failed to generate draft')
        } catch { setError('Failed to generate AI draft') }
        finally { setDraftLoading(false) }
    }

    const handleSendDraft = async () => {
        if (!userPhone || !pendingDraft) return
        setSending(true); setError(null)
        try {
            const res = await fetch(`/api/support/bot/draft/${encodeURIComponent(userPhone)}/send`, { method: 'POST' })
            if (res.ok) { setPendingDraft(null); setAiSuggestion(null); setShowAiPanel(false); fetchMessages() }
            else { const data = await res.json(); setError(data.error || 'Failed to send draft') }
        } catch { setError('Failed to send draft') }
        finally { setSending(false) }
    }

    const fetchMessages = async () => {
        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}/messages?limit=100`)
            const data = await res.json()
            if (data.messages) { setMessages(data.messages.reverse()); setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }
        } catch (error) { console.error('Failed to fetch messages', error) }
        finally { setLoadingMessages(false) }
    }

    const fetchNotes = async () => {
        try { const res = await fetch(`/api/admin/support/conversations/${conversation.id}/notes`); const data = await res.json(); if (data.notes) setNotes(data.notes) }
        catch (error) { console.error('Failed to fetch notes', error) }
    }

    const fetchDetails = async () => {
        try {
            const res = await fetch(`/api/admin/support/conversations/${conversation.id}`)
            const data = await res.json()
            if (data.conversation) { setConvDetails(data.conversation); if (data.conversation.notes) setNotes(data.conversation.notes) }
        } catch (error) { console.error('Failed to fetch details', error) }
    }

    useEffect(() => {
        fetchMessages(); fetchDetails(); fetchBotMode()
        const supabase = createClient()
        const channel = supabase
            .channel(`admin_support_messages:${conversation.id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${conversation.id}` }, () => { fetchMessages(); fetchDetails(); onUpdate() })
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [conversation.id])

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault()
        const msg = newMessage.trim()
        if (!msg) return
        setError(null); setSending(true)
        try {
            if (replyViaWhatsApp && hasWhatsApp) {
                setSendingWhatsApp(true)
                const waRes = await fetch('/api/support/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: conversation.id, toPhoneE164: (convDetails as any).whatsapp_user_phone || convDetails.created_by?.phone, text: msg }) })
                const waData = await waRes.json(); setSendingWhatsApp(false)
                if (!waRes.ok) { if (waData.storedInDb) setError(`WhatsApp delivery failed: ${waData.error}. Saved in app.`); else throw new Error(waData.error || 'Failed to send via WhatsApp') }
                setNewMessage(''); setAiSuggestion(null); fetchMessages(); onUpdate()
            } else {
                const res = await fetch(`/api/admin/support/conversations/${conversation.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
                if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Failed to send message') }
                setNewMessage(''); setAiSuggestion(null); fetchMessages(); onUpdate()
            }
        } catch (err: any) { setError(err.message === 'User not found' ? 'Admin profile missing. Contact developer.' : err.message) }
        finally { setSending(false); setSendingWhatsApp(false) }
    }

    const handleAiAssist = async () => {
        setAiLoading(true); setError(null); setShowAiPanel(true)
        try {
            const res = await fetch('/api/agent/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: conversation.id, tone: 'friendly' }) })
            const data = await res.json()
            if (data.ok && data.suggestedReply) setAiSuggestion(data.suggestedReply)
            else setError(data.error === 'User not found' ? 'AI unavailable (profile missing)' : data.error || 'AI unavailable')
        } catch { setError('Failed to get AI suggestion') }
        finally { setAiLoading(false) }
    }

    const useAiSuggestion = () => { if (aiSuggestion) { setNewMessage(aiSuggestion); setShowAiPanel(false) } }

    const handleAddNote = async () => {
        const note = newNote.trim(); if (!note) return
        try { const res = await fetch(`/api/admin/support/conversations/${conversation.id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note_text: note }) }); if (res.ok) { setNewNote(''); fetchNotes() } }
        catch (error) { console.error('Failed to add note', error) }
    }

    const handleStatusChange = async (newStatus: string) => {
        try { await fetch(`/api/admin/support/conversations/${conversation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) }); setConvDetails(prev => ({ ...prev, status: newStatus as any })); onUpdate() }
        catch (error) { console.error('Failed to update status', error) }
    }

    const handlePriorityChange = async (newPriority: string) => {
        try { await fetch(`/api/admin/support/conversations/${conversation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: newPriority }) }); setConvDetails(prev => ({ ...prev, priority: newPriority as any })) }
        catch (error) { console.error('Failed to update priority', error) }
    }

    const handleAssignChange = async (adminId: string | null) => {
        try {
            await fetch(`/api/admin/support/conversations/${conversation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_admin_id: adminId }) })
            const admin = admins.find(a => a.id === adminId)
            setConvDetails(prev => ({ ...prev, assigned_to: admin ? { id: admin.id, email: admin.email, full_name: admin.full_name } : undefined })); onUpdate()
        } catch (error) { console.error('Failed to update assignment', error) }
    }

    const statusConfig = STATUS_CONFIG[convDetails.status]
    const name = convDetails.created_by?.full_name || 'Unknown'

    // Group messages by date
    const groupedMessages = useMemo(() => {
        const groups: { date: string; messages: Message[] }[] = []
        let currentDate = ''
        messages.forEach(msg => {
            const d = format(new Date(msg.created_at), 'yyyy-MM-dd')
            if (d !== currentDate) { currentDate = d; groups.push({ date: d, messages: [msg] }) }
            else groups[groups.length - 1].messages.push(msg)
        })
        return groups
    }, [messages])

    return (
        <div className="flex h-full overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {/* Chat Header */}
                <div className="px-5 py-3 border-b border-slate-200/80 flex items-center justify-between bg-white">
                    <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-xs font-semibold text-white bg-gradient-to-br", avatarColor(name))}>
                            {getInitials(name)}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-slate-900 text-sm">{name}</h3>
                                {hasWhatsApp && <Badge variant="outline" className="h-5 px-1.5 bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px] font-medium"><Phone className="w-2.5 h-2.5 mr-0.5" />WhatsApp</Badge>}
                                <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px] font-medium", statusConfig.color)}>{statusConfig.label}</Badge>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                <span className="truncate max-w-[200px]">{convDetails.subject}</span>
                                <span className="text-slate-300">|</span>
                                <span className="font-mono">{convDetails.case_number}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {globalAiEnabled && hasWhatsApp && userPhone && (
                            <div className="flex items-center gap-2 mr-1">
                                {isAiEnabled ? (
                                    <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-1.5 border border-emerald-200">
                                        <Bot className="w-3.5 h-3.5 text-emerald-600" />
                                        <span className="text-[11px] font-semibold text-emerald-700">AI Auto</span>
                                        <Switch checked={true} onCheckedChange={() => handleBotModeToggle('takeover')} disabled={botModeLoading} className="data-[state=checked]:bg-emerald-500 h-4 w-7" />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
                                        <User className="w-3.5 h-3.5 text-slate-500" />
                                        <span className="text-[11px] font-medium text-slate-600">Manual</span>
                                        <Switch checked={false} onCheckedChange={() => handleBotModeToggle('auto')} disabled={botModeLoading} className="h-4 w-7" />
                                    </div>
                                )}
                            </div>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400"><MoreHorizontal className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => handleStatusChange('resolved')}><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-500" /> Mark Resolved</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange('closed')}><Archive className="w-3.5 h-3.5 mr-2 text-slate-500" /> Close</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleStatusChange('spam')}><AlertTriangle className="w-3.5 h-3.5 mr-2 text-red-500" /> Mark Spam</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className={cn("h-8 w-8 p-0", showSidebar ? "text-indigo-600" : "text-slate-400")} onClick={() => setShowSidebar(!showSidebar)}>
                                        {showSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p className="text-xs">{showSidebar ? 'Hide' : 'Details'}</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-red-50 border-b border-red-100 px-5 py-2 text-sm text-red-600 flex items-center justify-between">
                        <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" /><span>{error}</span></div>
                        <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 w-6 p-0 text-red-400"><X className="w-3.5 h-3.5" /></Button>
                    </div>
                )}

                {/* Messages */}
                <ScrollArea className="flex-1 overflow-y-auto">
                    <div className="max-w-3xl mx-auto px-5 py-4">
                        {loadingMessages ? (
                            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                        ) : (
                            groupedMessages.map((group) => (
                                <div key={group.date}>
                                    <div className="flex items-center justify-center py-3">
                                        <div className="bg-white text-[11px] text-slate-400 px-3 py-1 rounded-full border border-slate-100 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                                            {formatDateDivider(group.date)}
                                        </div>
                                    </div>
                                    {group.messages.map((msg) => {
                                        const isAdmin = msg.sender_type === 'admin'
                                        const isSystem = msg.sender_type === 'system'
                                        const channel = msg.channel || 'app'
                                        const channelCfg = CHANNEL_CONFIG[channel as keyof typeof CHANNEL_CONFIG] || CHANNEL_CONFIG.app
                                        const ChannelIcon = channelCfg.icon
                                        const isWhatsAppMsg = channel === 'whatsapp'
                                        const isAIMsg = channel === 'ai'

                                        if (isSystem) return (
                                            <div key={msg.id} className="flex justify-center py-2">
                                                <span className="bg-slate-100/80 text-slate-500 text-[10px] px-3 py-1 rounded-full">{msg.body_text}</span>
                                            </div>
                                        )

                                        return (
                                            <div key={msg.id} className={cn("flex mb-2.5", isAdmin ? "justify-end" : "justify-start")}>
                                                <div className={cn(
                                                    "max-w-[65%] rounded-2xl px-4 py-2.5 relative",
                                                    isAdmin ? "bg-indigo-600 text-white rounded-br-md shadow-sm" : "bg-white text-slate-800 border border-slate-100 rounded-bl-md shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                                                )}>
                                                    {(isWhatsAppMsg || (isAIMsg && isAiEnabled)) && (
                                                        <div className={cn("flex items-center gap-1 text-[10px] mb-1 font-medium", isAdmin ? "text-white/70" : isAIMsg ? "text-amber-500" : "text-emerald-500")}>
                                                            <ChannelIcon className="w-2.5 h-2.5" />
                                                            {isAIMsg ? 'AI Bot' : 'WhatsApp'}
                                                        </div>
                                                    )}
                                                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{msg.body_text}</p>
                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                                                            {msg.attachments.map((att: any, i: number) => (
                                                                <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className={cn("flex items-center gap-1.5 text-xs hover:underline", isAdmin ? "text-white/80" : "text-indigo-600")}>
                                                                    <Paperclip className="w-3 h-3" />{att.name || 'Attachment'}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className={cn("text-[9px] mt-1.5 flex items-center justify-end gap-1", isAdmin ? "text-white/50" : "text-slate-400")}>
                                                        {format(new Date(msg.created_at), 'HH:mm')}
                                                        {isAdmin && msg.read_by_user_at && <CheckCircle2 className="w-2.5 h-2.5" />}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ))
                        )}
                        <div ref={scrollRef} />
                    </div>
                </ScrollArea>

                {/* Reply Input */}
                <div className="p-4 border-t border-slate-200/80 bg-white">
                    {isAiEnabled && showAiPanel && (
                        <div className="mb-3 p-3 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/80 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 text-amber-700 text-xs font-semibold"><Sparkles className="w-3.5 h-3.5" />AI Suggestion</div>
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-amber-500" onClick={() => setShowAiPanel(false)}><X className="w-3.5 h-3.5" /></Button>
                            </div>
                            {aiLoading ? (
                                <div className="flex items-center gap-2 text-amber-600 text-xs py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating...</div>
                            ) : aiSuggestion ? (
                                <>
                                    <p className="text-[13px] text-slate-700 whitespace-pre-wrap mb-2 leading-relaxed">{aiSuggestion}</p>
                                    <div className="flex gap-2">
                                        <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg" onClick={useAiSuggestion}><Zap className="w-3 h-3 mr-1" /> Use Reply</Button>
                                        {pendingDraft && <Button size="sm" className="h-7 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg" onClick={handleSendDraft} disabled={sending}>{sending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}Send via WA</Button>}
                                    </div>
                                </>
                            ) : <p className="text-xs text-slate-400">No suggestion available</p>}
                        </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            {replyViaWhatsApp && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-600 border-emerald-200 font-medium"><Phone className="w-2.5 h-2.5 mr-1" />via WhatsApp</Badge>}
                        </div>
                        {isAiEnabled && (
                            <div className="flex items-center gap-1.5">
                                {hasWhatsApp && userPhone && (
                                    <Button variant="outline" size="sm" onClick={handleGenerateDraft} disabled={draftLoading} className="h-7 text-[11px] text-indigo-600 border-indigo-200 hover:bg-indigo-50 rounded-lg">
                                        {draftLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Bot className="w-3 h-3 mr-1" />}AI Draft
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={handleAiAssist} disabled={aiLoading} className="h-7 text-[11px] text-amber-600 border-amber-200 hover:bg-amber-50 rounded-lg">
                                    {aiLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}AI Assist
                                </Button>
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSend} className="flex gap-2">
                        <Textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder={replyViaWhatsApp ? "Type WhatsApp reply..." : "Type your reply..."}
                            className={cn("flex-1 resize-none min-h-[48px] max-h-[120px] bg-slate-50 text-[13px] rounded-xl border-slate-200", replyViaWhatsApp && "border-emerald-200")}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) } }}
                        />
                        <Button type="submit" disabled={!newMessage.trim() || sending} className={cn("px-4 h-auto min-h-[48px] rounded-xl", replyViaWhatsApp ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700")}>
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                    </form>
                    <p className="text-[10px] text-slate-400 mt-1.5">Enter to send, Shift+Enter for new line</p>
                </div>
            </div>

            {/* Sidebar */}
            <div className={cn("border-l border-slate-200/80 bg-white flex flex-col overflow-hidden transition-all duration-300", showSidebar ? "w-72 opacity-100" : "w-0 opacity-0")}>
                {showSidebar && (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full w-72">
                        <TabsList className="w-full justify-start rounded-none border-b border-slate-100 bg-white px-3 h-11">
                            <TabsTrigger value="chat" className="text-xs rounded-lg">Details</TabsTrigger>
                            <TabsTrigger value="notes" className="text-xs rounded-lg">Notes ({notes.length})</TabsTrigger>
                        </TabsList>

                        <TabsContent value="chat" className="flex-1 overflow-auto m-0 p-4 space-y-4">
                            <div>
                                <Label className="text-[11px] text-slate-400 mb-1.5 block uppercase tracking-wider font-medium">Status</Label>
                                <Select value={convDetails.status} onValueChange={handleStatusChange}>
                                    <SelectTrigger className="w-full bg-slate-50 border-slate-200 h-9 text-sm rounded-lg"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                                            <SelectItem key={key} value={key}><div className="flex items-center gap-2"><div className={cn("w-2 h-2 rounded-full", config.dotColor)} />{config.label}</div></SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-[11px] text-slate-400 mb-1.5 block uppercase tracking-wider font-medium">Priority</Label>
                                <Select value={convDetails.priority} onValueChange={handlePriorityChange}>
                                    <SelectTrigger className="w-full bg-slate-50 border-slate-200 h-9 text-sm rounded-lg"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                                            <SelectItem key={key} value={key}><div className="flex items-center gap-2"><div className={cn("w-2 h-2 rounded-full", config.dot)} />{config.label}</div></SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-[11px] text-slate-400 mb-1.5 block uppercase tracking-wider font-medium">Assigned To</Label>
                                <Select value={convDetails.assigned_to?.id || 'unassigned'} onValueChange={(v) => handleAssignChange(v === 'unassigned' ? null : v)}>
                                    <SelectTrigger className="w-full bg-slate-50 border-slate-200 h-9 text-sm rounded-lg"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="unassigned">Unassigned</SelectItem>
                                        {admins.map(admin => <SelectItem key={admin.id} value={admin.id}>{admin.full_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-[11px] text-slate-400 mb-1.5 block uppercase tracking-wider font-medium">Tags</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {convDetails.tags && convDetails.tags.length > 0 ? convDetails.tags.map(tag => (
                                        <Badge key={tag.id} variant="outline" style={{ backgroundColor: tag.color + '12', color: tag.color, borderColor: tag.color + '30' }} className="text-[10px]">{tag.name}</Badge>
                                    )) : <span className="text-xs text-slate-400">No tags</span>}
                                </div>
                            </div>
                            <div className="pt-3 border-t border-slate-100">
                                <Label className="text-[11px] text-slate-400 mb-2.5 block uppercase tracking-wider font-medium">Contact</Label>
                                <div className="space-y-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-semibold text-white bg-gradient-to-br", avatarColor(name))}>{getInitials(name)}</div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-700">{name}</p>
                                            <p className="text-[11px] text-slate-400">{convDetails.created_by?.email || ''}</p>
                                        </div>
                                    </div>
                                    {convDetails.created_by?.phone && <div className="flex items-center gap-2 text-xs text-slate-500"><Phone className="w-3 h-3 text-slate-400" />{convDetails.created_by.phone}</div>}
                                    <div className="flex items-center gap-2 text-[11px] text-slate-400"><Clock className="w-3 h-3" /><span>Created {formatDistanceToNow(new Date(convDetails.created_at), { addSuffix: true })}</span></div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="notes" className="flex-1 overflow-auto m-0 p-4 flex flex-col">
                            <div className="mb-3">
                                <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add internal note..." className="resize-none min-h-[70px] text-sm rounded-lg bg-slate-50" />
                                <Button size="sm" className="mt-2 w-full h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs" onClick={handleAddNote} disabled={!newNote.trim()}>
                                    <StickyNote className="w-3 h-3 mr-1.5" /> Add Note
                                </Button>
                            </div>
                            <div className="flex-1 space-y-2.5">
                                {notes.length === 0 ? <p className="text-xs text-slate-400 text-center py-6">No internal notes yet</p> : notes.map(note => (
                                    <div key={note.id} className="bg-amber-50/70 border border-amber-100 rounded-lg p-3">
                                        <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{note.note_text}</p>
                                        <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400">
                                            <span>{note.admin?.full_name || 'Admin'}</span>
                                            <span>{format(new Date(note.created_at), 'MMM d, HH:mm')}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// BLAST MODAL
// ═══════════════════════════════════════════════════════════
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
    const [progress, setProgress] = useState<{ status: 'idle' | 'sending' | 'complete' | 'error'; total: number; sent: number; failed: number; percent: number; message: string; errors?: string[] }>({ status: 'idle', total: 0, sent: 0, failed: 0, percent: 0, message: '' })

    const roleOptions = [{ value: 'consumer', label: 'Consumers' }, { value: 'shop', label: 'Shop Owners' }, { value: 'SA', label: 'Sales Agents' }, { value: 'HQ', label: 'HQ Staff' }]

    useEffect(() => { if (open) fetchStates() }, [open])
    useEffect(() => { if (open && message.trim()) fetchPreviewCount(); else setPreviewCount(null) }, [targetType, selectedStates, selectedRoles, open])

    const fetchStates = async () => {
        setLoadingStates(true)
        try { const res = await fetch('/api/admin/states'); const data = await res.json(); if (data.states) setStates(data.states) }
        catch (error) { console.error('Failed to fetch states', error) }
        finally { setLoadingStates(false) }
    }

    const fetchPreviewCount = async () => {
        setLoadingPreview(true)
        try { const res = await fetch('/api/admin/support/blast/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType, states: targetType === 'state' ? selectedStates : [], roles: targetType === 'role' ? selectedRoles : [] }) }); const data = await res.json(); setPreviewCount(data.count ?? null) }
        catch (error) { console.error('Failed to fetch preview', error) }
        finally { setLoadingPreview(false) }
    }

    const handleSend = async () => {
        if (!message.trim()) return
        setSending(true); setProgress({ status: 'sending', total: 0, sent: 0, failed: 0, percent: 0, message: 'Starting...' })
        try {
            const res = await fetch('/api/admin/support/blast/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, subject: 'Announcement', targetType, states: targetType === 'state' ? selectedStates : [], roles: targetType === 'role' ? selectedRoles : [] }) })
            if (!res.body) throw new Error('No response body')
            const reader = res.body.getReader(); const decoder = new TextDecoder()
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value)
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6))
                            if (data.type === 'error') setProgress(p => ({ ...p, status: 'error', message: data.error }))
                            else if (data.type === 'start') setProgress(p => ({ ...p, total: data.total, message: data.message }))
                            else if (data.type === 'progress') setProgress({ status: 'sending', total: data.total, sent: data.sent, failed: data.failed, percent: data.percent, message: data.message })
                            else if (data.type === 'complete') setProgress({ status: 'complete', total: data.total, sent: data.sent, failed: data.failed, percent: 100, message: data.message, errors: data.errors })
                        } catch (e) { /* parse error */ }
                    }
                }
            }
        } catch (error: any) { setProgress(p => ({ ...p, status: 'error', message: error.message || 'Failed' })) }
        finally { setSending(false) }
    }

    const handleClose = () => { if (!sending) { setMessage(''); setProgress({ status: 'idle', total: 0, sent: 0, failed: 0, percent: 0, message: '' }); onOpenChange(false) } }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg rounded-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><Megaphone className="w-4 h-4 text-purple-600" /></div>
                        Broadcast Message
                    </DialogTitle>
                    <DialogDescription>Send to users. Messages appear in their Support Inbox.</DialogDescription>
                </DialogHeader>
                {progress.status === 'idle' ? (
                    <div className="space-y-4">
                        <div>
                            <Label className="text-xs font-medium text-slate-600">Target</Label>
                            <div className="flex gap-2 mt-1.5">
                                {(['all', 'state', 'role'] as const).map(t => (
                                    <Button key={t} variant={targetType === t ? 'default' : 'outline'} size="sm" className="text-xs rounded-lg" onClick={() => setTargetType(t)}>
                                        {t === 'all' ? 'All Users' : t === 'state' ? 'By State' : 'By Role'}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        {targetType === 'state' && (
                            <div>
                                <Label className="text-xs">States</Label>
                                <div className="flex flex-wrap gap-2 mt-1.5 max-h-32 overflow-auto p-2 border rounded-lg">
                                    {loadingStates ? <Loader2 className="w-4 h-4 animate-spin" /> : states.map(s => (
                                        <label key={s.id} className="flex items-center gap-1.5 text-xs">
                                            <Checkbox checked={selectedStates.includes(s.state_code)} onCheckedChange={(c) => c ? setSelectedStates([...selectedStates, s.state_code]) : setSelectedStates(selectedStates.filter(x => x !== s.state_code))} />{s.state_name}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        {targetType === 'role' && (
                            <div>
                                <Label className="text-xs">Roles</Label>
                                <div className="flex flex-wrap gap-2 mt-1.5">
                                    {roleOptions.map(r => (
                                        <label key={r.value} className="flex items-center gap-1.5 text-xs">
                                            <Checkbox checked={selectedRoles.includes(r.value)} onCheckedChange={(c) => c ? setSelectedRoles([...selectedRoles, r.value]) : setSelectedRoles(selectedRoles.filter(x => x !== r.value))} />{r.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div>
                            <Label className="text-xs">Message</Label>
                            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your announcement..." className="mt-1.5 min-h-[100px] rounded-lg" />
                        </div>
                        {previewCount !== null && (
                            <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5 flex items-center gap-2 border"><Users className="w-3.5 h-3.5 text-indigo-500" />Sending to <strong>{previewCount.toLocaleString()}</strong> users</div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs"><span>{progress.message}</span><span className="font-mono">{progress.percent}%</span></div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5">
                                <div className={cn("h-2.5 rounded-full transition-all", progress.status === 'error' ? 'bg-red-500' : progress.status === 'complete' ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${progress.percent}%` }} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="bg-slate-50 rounded-xl p-3"><div className="text-xl font-bold">{progress.total}</div><div className="text-[10px] text-slate-500">Total</div></div>
                            <div className="bg-emerald-50 rounded-xl p-3"><div className="text-xl font-bold text-emerald-600">{progress.sent}</div><div className="text-[10px] text-slate-500">Sent</div></div>
                            <div className="bg-red-50 rounded-xl p-3"><div className="text-xl font-bold text-red-600">{progress.failed}</div><div className="text-[10px] text-slate-500">Failed</div></div>
                        </div>
                    </div>
                )}
                <DialogFooter>
                    {progress.status === 'idle' ? (
                        <>
                            <Button variant="outline" onClick={handleClose} className="rounded-lg">Cancel</Button>
                            <Button onClick={handleSend} disabled={!message.trim() || sending} className="bg-purple-600 hover:bg-purple-700 rounded-lg">
                                {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}Send
                            </Button>
                        </>
                    ) : progress.status === 'complete' || progress.status === 'error' ? (
                        <Button onClick={handleClose} className="rounded-lg">Close</Button>
                    ) : <Button disabled className="rounded-lg"><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending...</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default AdminSupportInboxV2
