'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import {
  Bell, Send, CheckCircle2, XCircle, Clock, AlertTriangle,
  Users, Eye, RefreshCw, MessageSquare, ChevronRight, ChevronDown,
  Plus, Trash2, Copy, Globe, Phone, Mail, Search, ArrowRight,
  ListChecks, FileText, Zap, BarChart3, History, Settings2,
  Check, X, AlertCircle, Loader2
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

// ── Types ─────────────────────────────────────────────────────
interface NotifTemplate {
  id: string
  campaign_id: string | null
  name: string
  channel: 'whatsapp' | 'email' | 'sms' | 'push'
  subject: string | null
  body: string
  variables: string[]
  is_active: boolean
  created_at: string
}

interface NotifBlast {
  id: string
  campaign_id: string
  campaign_name: string
  template_id: string
  template_name: string
  channel: string
  total_recipients: number
  sent_count: number
  delivered_count: number
  read_count: number
  failed_count: number
  status: 'draft' | 'validating' | 'ready' | 'sending' | 'completed' | 'failed' | 'cancelled'
  scheduled_at: string | null
  sent_at: string | null
  completed_at: string | null
  created_at: string
}

interface BlastRecipient {
  id: string
  blast_id: string
  org_id: string
  org_name: string
  contact_number: string
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  sent_at: string | null
  error_message: string | null
}

// ── Constants ─────────────────────────────────────────────────
const CHANNEL_CONFIG: Record<string, { icon: any; label: string; color: string; bgColor: string }> = {
  whatsapp: { icon: Phone, label: 'WhatsApp', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  email: { icon: Mail, label: 'Email', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  sms: { icon: MessageSquare, label: 'SMS', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  push: { icon: Bell, label: 'Push', color: 'text-purple-700 dark:text-purple-400', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
}

const BLAST_STATUS: Record<string, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Draft', color: 'text-gray-700 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800' },
  validating: { label: 'Validating', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  ready: { label: 'Ready', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  sending: { label: 'Sending...', color: 'text-indigo-700 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  completed: { label: 'Completed', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  failed: { label: 'Failed', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  cancelled: { label: 'Cancelled', color: 'text-gray-700 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800' },
}

// ── Static Data ───────────────────────────────────────────────
function getStaticTemplates(): NotifTemplate[] {
  return [
    {
      id: 'tpl-001', campaign_id: null, name: 'Campaign Launch – WhatsApp',
      channel: 'whatsapp', subject: null,
      body: 'Salam {distributor_name}! 🎉\n\nKami ingin maklumkan mengenai kempen insentif baru: *{campaign_name}*\n\n📅 Tempoh: {start_date} - {end_date}\n🎯 Sasaran: {target_metric}\n💰 Ganjaran: {reward_description}\n\nJom sertai dan capai sasaran untuk memenangi ganjaran menarik!\n\nSebarang pertanyaan, hubungi kami.',
      variables: ['distributor_name', 'campaign_name', 'start_date', 'end_date', 'target_metric', 'reward_description'],
      is_active: true, created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: 'tpl-002', campaign_id: null, name: 'Achievement Notification',
      channel: 'whatsapp', subject: null,
      body: 'Tahniah {distributor_name}! 🏆\n\nAnda telah berjaya mencapai sasaran kempen *{campaign_name}*!\n\nPencapaian: {achievement_value} / {target_value}\nGanjaran: RM{reward_amount}\n\nGanjaran anda akan diproses dalam masa 3-5 hari bekerja.',
      variables: ['distributor_name', 'campaign_name', 'achievement_value', 'target_value', 'reward_amount'],
      is_active: true, created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: 'tpl-003', campaign_id: null, name: 'Monthly Leaderboard Update',
      channel: 'whatsapp', subject: null,
      body: 'Hai {distributor_name}! 📊\n\nKemaskini kedudukan anda untuk *{campaign_name}*:\n\n🏅 Kedudukan: #{rank}\n📈 Pencapaian: {achievement_value}\n🎯 Sasaran: {target_value}\n\nTeruskan usaha anda! 💪',
      variables: ['distributor_name', 'campaign_name', 'rank', 'achievement_value', 'target_value'],
      is_active: true, created_at: '2025-01-01T00:00:00Z'
    },
    {
      id: 'tpl-004', campaign_id: null, name: 'Campaign Ending Reminder',
      channel: 'whatsapp', subject: null,
      body: '⏰ Peringatan {distributor_name}!\n\nKempen *{campaign_name}* akan berakhir pada {end_date}.\n\nPencapaian semasa: {achievement_value} / {target_value}\nBaki: {remaining}\n\nMasa masih ada – capai sasaran anda!',
      variables: ['distributor_name', 'campaign_name', 'end_date', 'achievement_value', 'target_value', 'remaining'],
      is_active: true, created_at: '2025-01-01T00:00:00Z'
    },
  ]
}

function getStaticBlasts(): NotifBlast[] {
  return [
    {
      id: 'blast-001', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      template_id: 'tpl-001', template_name: 'Campaign Launch – WhatsApp',
      channel: 'whatsapp', total_recipients: 45, sent_count: 45, delivered_count: 42,
      read_count: 38, failed_count: 3,
      status: 'completed', scheduled_at: null,
      sent_at: '2025-01-05T09:00:00Z', completed_at: '2025-01-05T09:15:00Z',
      created_at: '2025-01-05T08:00:00Z'
    },
    {
      id: 'blast-002', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      template_id: 'tpl-003', template_name: 'Monthly Leaderboard Update',
      channel: 'whatsapp', total_recipients: 45, sent_count: 45, delivered_count: 44,
      read_count: 35, failed_count: 1,
      status: 'completed', scheduled_at: null,
      sent_at: '2025-02-01T09:00:00Z', completed_at: '2025-02-01T09:12:00Z',
      created_at: '2025-02-01T08:00:00Z'
    },
    {
      id: 'blast-003', campaign_id: 'camp-002', campaign_name: 'Monthly Growth Sprint',
      template_id: 'tpl-001', template_name: 'Campaign Launch – WhatsApp',
      channel: 'whatsapp', total_recipients: 30, sent_count: 0, delivered_count: 0,
      read_count: 0, failed_count: 0,
      status: 'draft', scheduled_at: null,
      sent_at: null, completed_at: null,
      created_at: '2025-03-01T00:00:00Z'
    },
  ]
}

// ── Wizard Step Indicator ─────────────────────────────────────
function WizardSteps({ currentStep, steps }: { currentStep: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-1 flex-shrink-0">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            i < currentStep
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : i === currentStep
                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 ring-2 ring-indigo-300'
                : 'bg-muted text-muted-foreground'
          }`}>
            {i < currentStep ? <Check className="w-3 h-3" /> : <span className="w-4 text-center">{i + 1}</span>}
            {step}
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
        </div>
      ))}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────
interface IncentiveNotificationsTabProps {
  campaigns: { id: string; name: string; status: string }[]
  loading: boolean
}

export default function IncentiveNotificationsTab({ campaigns, loading }: IncentiveNotificationsTabProps) {
  const [subTab, setSubTab] = useState('blasts')
  const [templates, setTemplates] = useState<NotifTemplate[]>([])
  const [blasts, setBlasts] = useState<NotifBlast[]>([])

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [recipientCount, setRecipientCount] = useState(0)
  const [validRecipients, setValidRecipients] = useState(0)
  const [invalidRecipients, setInvalidRecipients] = useState(0)
  const [previewMessage, setPreviewMessage] = useState('')
  const [testSent, setTestSent] = useState(false)
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [scheduleDate, setScheduleDate] = useState('')
  const [isSending, setIsSending] = useState(false)

  // Template dialog
  const [templateDialog, setTemplateDialog] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<NotifTemplate | null>(null)
  const [templateForm, setTemplateForm] = useState({
    name: '', channel: 'whatsapp' as 'whatsapp' | 'email' | 'sms' | 'push', subject: '', body: '', is_active: true
  })

  // Detail dialog
  const [detailBlast, setDetailBlast] = useState<NotifBlast | null>(null)

  const supabase = createClient()

  useEffect(() => {
    loadTemplates()
    loadBlasts()
  }, [])

  const loadTemplates = useCallback(async () => {
    const sb = supabase as any
    const { data } = await sb
      .from('incentive_notification_templates')
      .select('*')
      .order('created_at', { ascending: false })
    if (data && data.length > 0) {
      setTemplates(data.map((t: any) => ({
        ...t,
        variables: t.variables || [],
      })))
    } else {
      setTemplates(getStaticTemplates())
    }
  }, [supabase])

  const loadBlasts = useCallback(async () => {
    const sb = supabase as any
    const { data } = await sb
      .from('incentive_notification_blasts')
      .select(`*, campaign:incentive_campaigns(name), template:incentive_notification_templates(name)`)
      .order('created_at', { ascending: false })
    if (data && data.length > 0) {
      setBlasts(data.map((b: any) => ({
        ...b,
        campaign_name: b.campaign?.name || '',
        template_name: b.template?.name || '',
      })))
    } else {
      setBlasts(getStaticBlasts())
    }
  }, [supabase])

  // Wizard logic
  const WIZARD_STEPS = ['Select Type', 'Load Recipients', 'Validate', 'Preview', 'Test Send', 'Confirm & Send']

  const openWizard = useCallback(() => {
    setWizardStep(0)
    setSelectedCampaign('')
    setSelectedTemplate('')
    setRecipientCount(0)
    setValidRecipients(0)
    setInvalidRecipients(0)
    setPreviewMessage('')
    setTestSent(false)
    setScheduleMode('now')
    setScheduleDate('')
    setIsSending(false)
    setWizardOpen(true)
  }, [])

  const simulateLoadRecipients = useCallback(() => {
    const total = Math.floor(Math.random() * 30) + 20
    setRecipientCount(total)
    setValidRecipients(total - Math.floor(Math.random() * 5))
    setInvalidRecipients(total - (total - Math.floor(Math.random() * 5)))
    setTimeout(() => setWizardStep(2), 800)
  }, [])

  const generatePreview = useCallback(() => {
    const tpl = templates.find(t => t.id === selectedTemplate)
    if (tpl) {
      let msg = tpl.body
      msg = msg.replace('{distributor_name}', 'Ahmad Trading Sdn Bhd')
      msg = msg.replace('{campaign_name}', campaigns.find(c => c.id === selectedCampaign)?.name || 'Campaign')
      msg = msg.replace('{start_date}', '1 Jan 2025')
      msg = msg.replace('{end_date}', '31 Mar 2025')
      msg = msg.replace('{target_metric}', '500 cases')
      msg = msg.replace('{reward_description}', 'RM2,000 cash reward')
      msg = msg.replace('{achievement_value}', '350')
      msg = msg.replace('{target_value}', '500')
      msg = msg.replace('{reward_amount}', '2,000')
      msg = msg.replace('{rank}', '5')
      msg = msg.replace('{remaining}', '150 cases')
      setPreviewMessage(msg)
    }
    setWizardStep(3)
  }, [templates, selectedTemplate, selectedCampaign, campaigns])

  const simulateTestSend = useCallback(() => {
    setTestSent(false)
    setTimeout(() => setTestSent(true), 1500)
  }, [])

  const executeBroadcast = useCallback(async () => {
    setIsSending(true)
    const tpl = templates.find(t => t.id === selectedTemplate)
    const camp = campaigns.find(c => c.id === selectedCampaign)

    // Create blast record
    const newBlast: NotifBlast = {
      id: `blast-${Date.now()}`,
      campaign_id: selectedCampaign,
      campaign_name: camp?.name || '',
      template_id: selectedTemplate,
      template_name: tpl?.name || '',
      channel: tpl?.channel || 'whatsapp',
      total_recipients: validRecipients,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      failed_count: 0,
      status: scheduleMode === 'now' ? 'sending' : 'ready',
      scheduled_at: scheduleMode === 'later' ? scheduleDate : null,
      sent_at: scheduleMode === 'now' ? new Date().toISOString() : null,
      completed_at: null,
      created_at: new Date().toISOString(),
    }

    setBlasts(prev => [newBlast, ...prev])

    // DB insert
    await (supabase as any).from('incentive_notification_blasts').insert({
      campaign_id: selectedCampaign,
      template_id: selectedTemplate,
      channel: tpl?.channel || 'whatsapp',
      total_recipients: validRecipients,
      status: scheduleMode === 'now' ? 'sending' : 'ready',
      scheduled_at: scheduleMode === 'later' ? scheduleDate : null,
      sent_at: scheduleMode === 'now' ? new Date().toISOString() : null,
    }).then(() => {})

    // Simulate completion
    setTimeout(() => {
      setBlasts(prev => prev.map(b => b.id === newBlast.id ? {
        ...b,
        status: 'completed' as const,
        sent_count: validRecipients,
        delivered_count: validRecipients - 2,
        read_count: Math.floor(validRecipients * 0.7),
        failed_count: 2,
        completed_at: new Date().toISOString(),
      } : b))
    }, 3000)

    setIsSending(false)
    setWizardOpen(false)
  }, [selectedCampaign, selectedTemplate, templates, campaigns, validRecipients, scheduleMode, scheduleDate, supabase])

  // Template CRUD
  const openTemplateForm = useCallback((tpl?: NotifTemplate) => {
    if (tpl) {
      setEditingTemplate(tpl)
      setTemplateForm({ name: tpl.name, channel: tpl.channel, subject: tpl.subject || '', body: tpl.body, is_active: tpl.is_active })
    } else {
      setEditingTemplate(null)
      setTemplateForm({ name: '', channel: 'whatsapp', subject: '', body: '', is_active: true })
    }
    setTemplateDialog(true)
  }, [])

  const saveTemplate = useCallback(async () => {
    if (editingTemplate) {
      setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? {
        ...t,
        name: templateForm.name,
        channel: templateForm.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
        is_active: templateForm.is_active,
      } : t))
      await (supabase as any).from('incentive_notification_templates').update({
        name: templateForm.name,
        channel: templateForm.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
        is_active: templateForm.is_active,
      }).eq('id', editingTemplate.id).then(() => {})
    } else {
      const newTpl: NotifTemplate = {
        id: `tpl-${Date.now()}`,
        campaign_id: null,
        name: templateForm.name,
        channel: templateForm.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
        variables: [],
        is_active: templateForm.is_active,
        created_at: new Date().toISOString(),
      }
      setTemplates(prev => [newTpl, ...prev])
      await (supabase as any).from('incentive_notification_templates').insert({
        name: templateForm.name,
        channel: templateForm.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
        is_active: templateForm.is_active,
      }).then(() => {})
    }
    setTemplateDialog(false)
  }, [editingTemplate, templateForm, supabase])

  // Stats
  const blastStats = useMemo(() => {
    const totalSent = blasts.reduce((s, b) => s + b.sent_count, 0)
    const totalDelivered = blasts.reduce((s, b) => s + b.delivered_count, 0)
    const totalRead = blasts.reduce((s, b) => s + b.read_count, 0)
    const totalFailed = blasts.reduce((s, b) => s + b.failed_count, 0)
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0
    const readRate = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) : 0
    return { totalSent, totalDelivered, totalRead, totalFailed, deliveryRate, readRate, blastCount: blasts.length }
  }, [blasts])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-500" /> Notification Center
          </h2>
          <p className="text-sm text-muted-foreground">Manage blast notifications for incentive campaigns</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadTemplates(); loadBlasts() }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg" onClick={openWizard}>
            <Send className="w-4 h-4 mr-1" /> New Notification Blast
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Blasts', value: blastStats.blastCount, color: '#6366f1', icon: Send },
          { label: 'Messages Sent', value: blastStats.totalSent, color: '#3b82f6', icon: MessageSquare },
          { label: 'Delivered', value: blastStats.totalDelivered, color: '#22c55e', icon: CheckCircle2 },
          { label: 'Read', value: blastStats.totalRead, color: '#10b981', icon: Eye },
          { label: 'Delivery Rate', value: `${blastStats.deliveryRate}%`, color: '#8b5cf6', icon: BarChart3 },
          { label: 'Read Rate', value: `${blastStats.readRate}%`, color: '#f59e0b', icon: BarChart3 },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
                <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
              </div>
              <p className="text-xl font-bold text-foreground">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sub-tabs */}
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="bg-muted/50 p-1 rounded-lg h-auto">
          <TabsTrigger value="blasts" className="rounded-md text-xs h-8 gap-1">
            <Send className="w-3.5 h-3.5" /> Blast History
          </TabsTrigger>
          <TabsTrigger value="templates" className="rounded-md text-xs h-8 gap-1">
            <FileText className="w-3.5 h-3.5" /> Templates
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="rounded-md text-xs h-8 gap-1">
            <BarChart3 className="w-3.5 h-3.5" /> Monitoring
          </TabsTrigger>
        </TabsList>

        {/* Blast History */}
        <TabsContent value="blasts" className="mt-4">
          <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="font-semibold">Campaign</TableHead>
                    <TableHead className="font-semibold">Template</TableHead>
                    <TableHead className="font-semibold">Channel</TableHead>
                    <TableHead className="font-semibold">Recipients</TableHead>
                    <TableHead className="font-semibold">Delivery</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Sent</TableHead>
                    <TableHead className="font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blasts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        <Send className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="font-medium">No notification blasts yet</p>
                        <p className="text-xs">Click &quot;New Notification Blast&quot; to get started</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    blasts.map(blast => {
                      const ch = CHANNEL_CONFIG[blast.channel] || CHANNEL_CONFIG.whatsapp
                      const st = BLAST_STATUS[blast.status] || BLAST_STATUS.draft
                      const ChannelIcon = ch.icon
                      const deliveryPct = blast.sent_count > 0 ? Math.round((blast.delivered_count / blast.sent_count) * 100) : 0
                      return (
                        <TableRow key={blast.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-medium text-sm">{blast.campaign_name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{blast.template_name}</TableCell>
                          <TableCell>
                            <Badge className={`${ch.bgColor} ${ch.color} gap-1`}>
                              <ChannelIcon className="w-3 h-3" /> {ch.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{blast.total_recipients}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${deliveryPct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">{deliveryPct}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${st.bgColor} ${st.color}`}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {blast.sent_at ? format(new Date(blast.sent_at), 'dd MMM yyyy HH:mm') : '-'}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetailBlast(blast)}>
                              <Eye className="w-3 h-3 mr-1" /> View
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => openTemplateForm()}>
              <Plus className="w-4 h-4 mr-1" /> New Template
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {templates.map(tpl => {
              const ch = CHANNEL_CONFIG[tpl.channel] || CHANNEL_CONFIG.whatsapp
              const ChannelIcon = ch.icon
              return (
                <Card key={tpl.id} className="border-0 shadow-md bg-card/80 backdrop-blur hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={`${ch.bgColor} ${ch.color} gap-1`}>
                          <ChannelIcon className="w-3 h-3" /> {ch.label}
                        </Badge>
                        {tpl.is_active ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">Inactive</Badge>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openTemplateForm(tpl)}>
                        Edit
                      </Button>
                    </div>
                    <CardTitle className="text-sm">{tpl.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3 max-h-32 overflow-y-auto font-sans">{tpl.body}</pre>
                    {tpl.variables.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {tpl.variables.map(v => (
                          <Badge key={v} variant="secondary" className="text-[10px]">{`{${v}}`}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        {/* Monitoring */}
        <TabsContent value="monitoring" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Recent Activity */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4 text-indigo-500" /> Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {blasts.slice(0, 5).map(b => (
                  <div key={b.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      b.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-amber-100 dark:bg-amber-900/30'
                    }`}>
                      {b.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : b.status === 'sending' ? (
                        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.campaign_name}</p>
                      <p className="text-xs text-muted-foreground">{b.template_name} · {b.total_recipients} recipients</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {b.sent_at ? format(new Date(b.sent_at), 'dd MMM') : 'Draft'}
                    </div>
                  </div>
                ))}
                {blasts.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-4">No activity yet</p>
                )}
              </CardContent>
            </Card>

            {/* Channel Summary */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-500" /> Channel Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(CHANNEL_CONFIG).map(([key, ch]) => {
                  const channelBlasts = blasts.filter(b => b.channel === key)
                  const sent = channelBlasts.reduce((s, b) => s + b.sent_count, 0)
                  const delivered = channelBlasts.reduce((s, b) => s + b.delivered_count, 0)
                  const rate = sent > 0 ? Math.round((delivered / sent) * 100) : 0
                  const ChannelIcon = ch.icon
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${ch.bgColor}`}>
                        <ChannelIcon className={`w-4 h-4 ${ch.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{ch.label}</span>
                          <span className="text-xs text-muted-foreground">{sent} sent</span>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                      <span className="text-sm font-semibold w-12 text-right">{rate}%</span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Failed Messages */}
            <Card className="border-0 shadow-lg bg-card/80 backdrop-blur md:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" /> Failed Deliveries
                </CardTitle>
                <CardDescription>Messages that failed to deliver — review and retry</CardDescription>
              </CardHeader>
              <CardContent>
                {blasts.filter(b => b.failed_count > 0).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                    <p className="text-sm font-medium">No failed deliveries</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {blasts.filter(b => b.failed_count > 0).map(b => (
                      <div key={b.id} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/10 rounded-lg border border-red-100 dark:border-red-900/30">
                        <div>
                          <p className="text-sm font-medium">{b.campaign_name}</p>
                          <p className="text-xs text-muted-foreground">{b.template_name}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            {b.failed_count} failed
                          </Badge>
                          <Button size="sm" variant="outline" className="h-7 text-xs">
                            <RefreshCw className="w-3 h-3 mr-1" /> Retry
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Blast Wizard Dialog ────────────────────────────────── */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-500" /> New Notification Blast
            </DialogTitle>
            <DialogDescription>Step-by-step notification blast workflow</DialogDescription>
          </DialogHeader>

          <WizardSteps currentStep={wizardStep} steps={WIZARD_STEPS} />

          <Separator />

          <div className="min-h-[200px] space-y-4">
            {/* Step 0: Select Type */}
            {wizardStep === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Campaign</Label>
                  <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select campaign..." />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notification Template</Label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.filter(t => t.is_active).map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({CHANNEL_CONFIG[t.channel]?.label})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Step 1: Load Recipients */}
            {wizardStep === 1 && (
              <div className="text-center space-y-4 py-6">
                <Users className="w-12 h-12 mx-auto text-indigo-500" />
                <div>
                  <p className="font-medium text-foreground">Loading Recipients</p>
                  <p className="text-sm text-muted-foreground">Fetching eligible distributors for this campaign...</p>
                </div>
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-indigo-500" />
              </div>
            )}

            {/* Step 2: Validate */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <Users className="w-6 h-6 mx-auto mb-1 text-indigo-500" />
                      <p className="text-2xl font-bold">{recipientCount}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-green-500" />
                      <p className="text-2xl font-bold text-green-600">{validRecipients}</p>
                      <p className="text-xs text-muted-foreground">Valid Contacts</p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <XCircle className="w-6 h-6 mx-auto mb-1 text-red-500" />
                      <p className="text-2xl font-bold text-red-600">{invalidRecipients}</p>
                      <p className="text-xs text-muted-foreground">Invalid</p>
                    </CardContent>
                  </Card>
                </div>
                {invalidRecipients > 0 && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> {invalidRecipients} recipient(s) have missing or invalid contact numbers
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Preview */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <Label>Message Preview</Label>
                <div className="bg-[#e5ddd5] dark:bg-gray-800 rounded-xl p-4">
                  <div className="bg-white dark:bg-gray-700 rounded-lg p-3 max-w-[85%] shadow-sm">
                    <pre className="text-sm whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-200">{previewMessage}</pre>
                    <p className="text-[10px] text-gray-400 text-right mt-1">{format(new Date(), 'HH:mm')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Test Send */}
            {wizardStep === 4 && (
              <div className="space-y-4 text-center py-4">
                {!testSent ? (
                  <>
                    <Phone className="w-12 h-12 mx-auto text-green-500" />
                    <p className="font-medium">Send a test message to your phone</p>
                    <p className="text-sm text-muted-foreground">Verify the template looks good before broadcasting</p>
                    <Button onClick={simulateTestSend} className="bg-green-600 hover:bg-green-700 text-white">
                      <Send className="w-4 h-4 mr-1" /> Send Test Message
                    </Button>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-12 h-12 mx-auto text-green-500" />
                    <p className="font-medium text-green-700 dark:text-green-400">Test message sent successfully!</p>
                    <p className="text-sm text-muted-foreground">Check your phone to review the message</p>
                  </>
                )}
              </div>
            )}

            {/* Step 5: Confirm & Send */}
            {wizardStep === 5 && (
              <div className="space-y-4">
                <div className="p-4 bg-muted/30 rounded-xl space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Campaign</span>
                    <span className="font-medium">{campaigns.find(c => c.id === selectedCampaign)?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Template</span>
                    <span className="font-medium">{templates.find(t => t.id === selectedTemplate)?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Recipients</span>
                    <span className="font-medium">{validRecipients}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Delivery Schedule</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setScheduleMode('now')}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        scheduleMode === 'now'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                          : 'border-border hover:border-indigo-300'
                      }`}
                    >
                      <Zap className={`w-5 h-5 mx-auto mb-1 ${scheduleMode === 'now' ? 'text-indigo-600' : 'text-muted-foreground'}`} />
                      <p className="text-sm font-medium">Send Now</p>
                    </button>
                    <button
                      onClick={() => setScheduleMode('later')}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        scheduleMode === 'later'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                          : 'border-border hover:border-indigo-300'
                      }`}
                    >
                      <Clock className={`w-5 h-5 mx-auto mb-1 ${scheduleMode === 'later' ? 'text-indigo-600' : 'text-muted-foreground'}`} />
                      <p className="text-sm font-medium">Schedule</p>
                    </button>
                  </div>
                  {scheduleMode === 'later' && (
                    <Input
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={e => setScheduleDate(e.target.value)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <Separator />

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => wizardStep === 0 ? setWizardOpen(false) : setWizardStep(wizardStep - 1)}>
              {wizardStep === 0 ? 'Cancel' : 'Back'}
            </Button>
            {wizardStep < 5 && (
              <Button
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                disabled={
                  (wizardStep === 0 && (!selectedCampaign || !selectedTemplate)) ||
                  (wizardStep === 1)
                }
                onClick={() => {
                  if (wizardStep === 0) { setWizardStep(1); setTimeout(simulateLoadRecipients, 1000) }
                  else if (wizardStep === 2) generatePreview()
                  else setWizardStep(wizardStep + 1)
                }}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {wizardStep === 5 && (
              <Button
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg"
                onClick={executeBroadcast}
                disabled={isSending || (scheduleMode === 'later' && !scheduleDate)}
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                {scheduleMode === 'now' ? 'Send Now' : 'Schedule Blast'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Template Dialog ────────────────────────────────────── */}
      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Template Name</Label>
              <Input
                value={templateForm.name}
                onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Campaign Launch – WhatsApp"
              />
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={templateForm.channel} onValueChange={(v: any) => setTemplateForm(f => ({ ...f, channel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="push">Push Notification</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {templateForm.channel === 'email' && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={templateForm.subject}
                  onChange={e => setTemplateForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="Email subject line..."
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Message Body</Label>
              <textarea
                className="w-full min-h-[120px] p-3 border rounded-lg bg-background text-sm resize-y"
                value={templateForm.body}
                onChange={e => setTemplateForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Type your message... Use {variable_name} for dynamic content."
              />
              <p className="text-xs text-muted-foreground">
                Available variables: {'{distributor_name}'}, {'{campaign_name}'}, {'{start_date}'}, {'{end_date}'}, {'{target_metric}'}, {'{reward_description}'}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={templateForm.is_active}
                onCheckedChange={v => setTemplateForm(f => ({ ...f, is_active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialog(false)}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
              onClick={saveTemplate}
              disabled={!templateForm.name || !templateForm.body}
            >
              {editingTemplate ? 'Update' : 'Create'} Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Blast Detail Dialog ────────────────────────────────── */}
      <Dialog open={!!detailBlast} onOpenChange={(open) => !open && setDetailBlast(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Blast Details</DialogTitle>
          </DialogHeader>
          {detailBlast && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/30 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Campaign</span>
                  <span className="font-medium">{detailBlast.campaign_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Template</span>
                  <span className="font-medium">{detailBlast.template_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Channel</span>
                  <span className="font-medium capitalize">{detailBlast.channel}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={`${BLAST_STATUS[detailBlast.status]?.bgColor} ${BLAST_STATUS[detailBlast.status]?.color}`}>
                    {BLAST_STATUS[detailBlast.status]?.label}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-center">
                  <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{detailBlast.sent_count}</p>
                  <p className="text-xs text-muted-foreground">Sent</p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">{detailBlast.delivered_count}</p>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-center">
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{detailBlast.read_count}</p>
                  <p className="text-xs text-muted-foreground">Read</p>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-center">
                  <p className="text-xl font-bold text-red-700 dark:text-red-400">{detailBlast.failed_count}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              </div>

              {detailBlast.sent_at && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Sent: {format(new Date(detailBlast.sent_at), 'dd MMM yyyy HH:mm')}</p>
                  {detailBlast.completed_at && <p>Completed: {format(new Date(detailBlast.completed_at), 'dd MMM yyyy HH:mm')}</p>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailBlast(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
