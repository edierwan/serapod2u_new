'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, Save, AlertTriangle, Users, Calendar as CalendarIcon, Clock, Smartphone, ChevronRight, Check, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AudienceFilterBuilder, AudienceFilters } from './AudienceFilterBuilder';
import { AudienceEstimator } from './AudienceEstimator';
import { SpecificUserSelector } from './SpecificUserSelector';
import { 
    validateTemplate, 
    getRiskLevel, 
    getRiskBadgeColor, 
    getRiskBadgeLabel,
    type TemplateSafetyResult
} from '@/lib/template-safety.client';

type WizardProps = {
    onCancel: () => void;
    onComplete: () => void;
    editingCampaign?: any;
};

export function CreateCampaignWizard({ onCancel, onComplete, editingCampaign }: WizardProps) {
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [estimatedRecipients, setEstimatedRecipients] = useState(0);
    const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

    const [segments, setSegments] = useState<any[]>([]);
    const [templates, setTemplates] = useState<any[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
    
    // Message safety validation
    const [messageSafety, setMessageSafety] = useState<TemplateSafetyResult | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        objective: 'Promo',

        // Audience
        audienceMode: 'filters' as 'filters' | 'segment' | 'specific_users',
        selectedSegmentId: '',
        selectedUserIds: [] as string[],
        filters: {
            organization_type: 'all',
            state: 'any',
            opt_in_only: true,
            only_valid_whatsapp: true
        } as AudienceFilters,

        message: '',
        templateId: '',
        scheduleType: 'now',
        scheduledDate: undefined as Date | undefined,
        quietHours: true
    });

    // Load editing campaign data if provided
    useEffect(() => {
        if (editingCampaign) {
            const audienceFilters = editingCampaign.audience_filters || {};
            setFormData({
                name: editingCampaign.name || '',
                objective: editingCampaign.objective || 'Promo',
                audienceMode: audienceFilters.mode || 'filters',
                selectedSegmentId: audienceFilters.segment_id || '',
                selectedUserIds: audienceFilters.user_ids || [],
                filters: audienceFilters.filters || {
                    organization_type: 'all',
                    state: 'any',
                    opt_in_only: true,
                    only_valid_whatsapp: true
                },
                message: editingCampaign.message_body || '',
                templateId: editingCampaign.template_id || '',
                scheduleType: editingCampaign.scheduled_at ? 'schedule' : 'now',
                scheduledDate: editingCampaign.scheduled_at ? new Date(editingCampaign.scheduled_at) : undefined,
                quietHours: editingCampaign.quiet_hours_enabled !== false
            });
            setEstimatedRecipients(audienceFilters.estimated_count || 0);
        }
    }, [editingCampaign]);

    useEffect(() => {
        // Fetch Segments
        console.log('Fetching segments and templates...');
        fetch('/api/wa/marketing/segments')
            .then(r => r.json())
            .then(d => setSegments(Array.isArray(d) ? d : []))
            .catch(err => console.error('Error fetching segments:', err));

        // Fetch Templates
        fetch('/api/wa/marketing/templates')
            .then(r => r.json())
            .then(d => {
                console.log('Templates fetched:', d);
                if (Array.isArray(d)) {
                    setTemplates(d);
                } else {
                    setTemplates([]);
                }
            })
            .catch(err => console.error('Error fetching templates:', err));
    }, []);

    // Validate message safety when it changes
    useEffect(() => {
        if (formData.message) {
            const result = validateTemplate(formData.message);
            setMessageSafety(result);
            // Reset acknowledgement if risk changes
            if (result.riskScore >= 80 || result.riskScore < 50) {
                setAcknowledgeRisk(false);
            }
        } else {
            setMessageSafety(null);
        }
    }, [formData.message]);

    // Memoized count change handler
    const handleCountChange = useCallback((count: number) => {
        setEstimatedRecipients(count);
    }, []);

    const steps = [
        { num: 1, label: 'Objective' },
        { num: 2, label: 'Audience' },
        { num: 3, label: 'Message' },
        { num: 4, label: 'Review' }
    ];

    const handleNext = () => setStep(s => Math.min(s + 1, 4));
    const handleBack = () => setStep(s => Math.max(s - 1, 1));

    const handleTestSend = async () => {
        if (!formData.message) {
            toast({ title: "Error", description: "Please enter a message first.", variant: "destructive" });
            return;
        }
        setTesting(true);
        try {
            const res = await fetch('/api/wa/marketing/test-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: formData.message })
            });
            const data = await res.json();
            if (res.ok) {
                toast({ title: "Sent", description: data.sent_to ? `Test message sent to ${data.sent_to}` : "Test message sent" });
            } else {
                toast({ title: "Error", description: data.error, variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to send test message", variant: "destructive" });
        } finally {
            setTesting(false);
        }
    };

    const handleLaunch = async () => {
        if (!formData.name || !formData.message) {
            toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
            return;
        }

        // Pre-send safety checks
        if (messageSafety) {
            // Block if risk >= 80
            if (messageSafety.riskScore >= 80) {
                toast({ 
                    title: "Campaign Blocked", 
                    description: "Message has critical safety issues. Please fix them before launching.", 
                    variant: "destructive" 
                });
                return;
            }

            // Require acknowledgement if risk 50-79
            if (messageSafety.riskScore >= 50 && !acknowledgeRisk) {
                toast({ 
                    title: "Acknowledgement Required", 
                    description: "Please acknowledge the risks before launching this campaign.", 
                    variant: "destructive" 
                });
                return;
            }

            // Check for blocking errors
            if (!messageSafety.isValid) {
                toast({ 
                    title: "Cannot Launch", 
                    description: messageSafety.errors[0]?.message || "Message has validation errors.", 
                    variant: "destructive" 
                });
                return;
            }
        }
        setSubmitting(true);
        try {
            // First, create/update the campaign
            const res = await fetch('/api/wa/marketing/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    objective: formData.objective,
                    audience_filters: {
                        mode: formData.audienceMode,
                        filters: formData.filters,
                        segment_id: formData.selectedSegmentId,
                        user_ids: formData.selectedUserIds,
                        estimated_count: estimatedRecipients
                    },
                    message_body: formData.message,
                    template_id: formData.templateId,
                    scheduled_at: formData.scheduleType === 'schedule' ? formData.scheduledDate : null,
                    quiet_hours_enabled: formData.quietHours
                })
            });

            if (res.ok) {
                const campaignData = await res.json();
                
                // If "Send Now", launch the campaign immediately
                if (formData.scheduleType === 'now' && campaignData?.id) {
                    toast({ title: "Campaign Created", description: "Now sending to recipients..." });
                    
                    const launchRes = await fetch(`/api/wa/marketing/campaigns/${campaignData.id}/launch`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (launchRes.ok) {
                        const launchData = await launchRes.json();
                        toast({ 
                            title: "Campaign Launched! 🚀", 
                            description: launchData.message || `Sending to ${estimatedRecipients} recipients` 
                        });
                    } else {
                        const launchError = await launchRes.json();
                        toast({ 
                            title: "Campaign Created", 
                            description: `Campaign saved but launch failed: ${launchError.error}`, 
                            variant: "destructive" 
                        });
                    }
                } else {
                    toast({ title: "Success", description: "Campaign scheduled successfully!" });
                }
                
                onComplete();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.error, variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to create campaign", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    const insertVariable = (variable: string) => {
        setFormData(prev => ({ ...prev, message: prev.message + variable }));
    };

    const riskLevel = estimatedRecipients > 5000 ? 'High' : estimatedRecipients > 1000 ? 'Medium' : 'Low';

    // Helper function for category badge colors
    const getCategoryBadgeColor = (category: string) => {
        if (selectedCategory === category) return '';
        const colors: Record<string, string> = {
            'Engagement': 'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200',
            'Informational': 'hover:bg-gray-50 hover:text-gray-700',
            'Loyalty': 'hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200',
            'Promotional': 'hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200',
            'Reactivation': 'hover:bg-red-50 hover:text-red-700 hover:border-red-200',
            'Seasonal': 'hover:bg-green-50 hover:text-green-700 hover:border-green-200',
            'VIP': 'hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-200',
            'General': 'hover:bg-gray-50',
        };
        return colors[category] || '';
    };

    return (
        <Card className="w-full border shadow-sm flex flex-col max-h-[calc(100vh-200px)] overflow-hidden">
            <CardHeader className="flex-shrink-0">
                <div className="flex justify-between items-center mb-8">
                    <CardTitle className="text-xl">{editingCampaign ? 'Edit Campaign' : 'Create New Campaign'}</CardTitle>
                    <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                </div>
                {/* Stepper */}
                <div className="flex justify-between relative max-w-4xl mx-auto w-full px-4 mb-4">
                    <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-100 -z-10 -translate-y-1/2" />
                    {steps.map((s) => (
                        <div key={s.num} className="flex flex-col items-center gap-2 bg-white px-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors
                                ${step >= s.num ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-white text-gray-400 border-gray-200'}`}>
                                {step > s.num ? <Check className="w-5 h-5" /> : s.num}
                            </div>
                            <span className={`text-xs font-medium uppercase tracking-wider ${step >= s.num ? 'text-gray-900' : 'text-gray-400'}`}>{s.label}</span>
                        </div>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="pt-8 min-h-[400px] flex-1 overflow-y-auto">
                {/* Step 1: Objective */}
                {step === 1 && (
                    <div className="max-w-4xl mx-auto space-y-8">
                        <div className="grid md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <Label className="text-base">Campaign Name</Label>
                                <Input
                                    className="h-12 text-lg"
                                    placeholder="e.g. End of Month Sale"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                                <p className="text-sm text-gray-500">Give your campaign a descriptive name for internal tracking.</p>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-base">Objective</Label>
                                <Select value={formData.objective} onValueChange={v => setFormData({ ...formData, objective: v })}>
                                    <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Promo">Marketing / Promo</SelectItem>
                                        <SelectItem value="Announcement">Announcement</SelectItem>
                                        <SelectItem value="Loyalty Reminder">Loyalty Reminder</SelectItem>
                                        <SelectItem value="Winback">User Winback</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-sm text-gray-500">This helps categorize your campaigns in reports.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Audience */}
                {step === 2 && (
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 min-h-[500px]">
                        {/* Left Column: Filters - 2/5 = 40% */}
                        <div className="md:col-span-2 space-y-4 flex flex-col h-full order-2 md:order-1">
                            <h3 className="font-medium">Define Audience</h3>

                            <div className="space-y-2">
                                <Label>Audience Source</Label>
                                <Tabs value={formData.audienceMode} onValueChange={(v: any) => setFormData({ ...formData, audienceMode: v })} className="w-full">
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="filters">Filters</TabsTrigger>
                                        <TabsTrigger value="segment">Saved Segment</TabsTrigger>
                                        <TabsTrigger value="specific_users">Manual</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>

                            <ScrollArea className="flex-1 pr-4">
                                {formData.audienceMode === 'filters' && (
                                    <AudienceFilterBuilder
                                        filters={formData.filters}
                                        onChange={(f: AudienceFilters) => setFormData({ ...formData, filters: f })}
                                    />
                                )}

                                {formData.audienceMode === 'segment' && (
                                    <div className="space-y-2 pt-2">
                                        <Label>Select Segment</Label>
                                        <Select
                                            value={formData.selectedSegmentId}
                                            onValueChange={(v) => setFormData({ ...formData, selectedSegmentId: v })}
                                        >
                                            <SelectTrigger><SelectValue placeholder="Choose a segment..." /></SelectTrigger>
                                            <SelectContent>
                                                {segments.length === 0 ? (
                                                    <SelectItem value="none" disabled>No saved segments</SelectItem>
                                                ) : (
                                                    segments.map((s: any) => (
                                                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.estimated_count} users)</SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        {formData.selectedSegmentId && (
                                            <p className="text-xs text-muted-foreground mt-2">
                                                {segments.find((s: any) => s.id === formData.selectedSegmentId)?.description}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {formData.audienceMode === 'specific_users' && (
                                    <SpecificUserSelector
                                        selectedUserIds={formData.selectedUserIds}
                                        onSelect={(ids) => setFormData({ ...formData, selectedUserIds: ids })}
                                    />
                                )}
                            </ScrollArea>
                        </div>

                        {/* Right Column: Preview - 3/5 = 60% */}
                        <div className="md:col-span-3 h-full order-1 md:order-2">
                            <AudienceEstimator
                                mode={formData.audienceMode}
                                filters={formData.filters}
                                segmentId={formData.selectedSegmentId}
                                userIds={formData.selectedUserIds}
                                onCountChange={(count) => setEstimatedRecipients(count)}
                            />
                        </div>
                    </div>
                )}

                {/* Step 3: Message */}
                {step === 3 && (
                    <div className="grid md:grid-cols-2 gap-8 h-[500px]">
                        <div className="flex flex-col gap-4 h-full overflow-hidden">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Template Category</Label>
                                    <ScrollArea className="w-full whitespace-nowrap pb-2">
                                        <div className="flex w-max space-x-2 p-1">
                                            {['All Categories', 'Engagement', 'Informational', 'Loyalty', 'Promotional', 'Reactivation', 'Seasonal', 'VIP'].map((cat) => {
                                                const count = cat === 'All Categories' ? templates.length : templates.filter(t => (t.category || 'General') === cat).length;
                                                return (
                                                <Badge
                                                    key={cat}
                                                    variant={selectedCategory === cat ? "default" : "outline"}
                                                    className={`cursor-pointer px-3 py-1 font-normal transition-colors ${
                                                        selectedCategory === cat ? '' : 'hover:bg-muted'
                                                    } ${getCategoryBadgeColor(cat)}`}
                                                    onClick={() => {
                                                        setSelectedCategory(cat);
                                                    }}
                                                >
                                                    {cat}
                                                    {cat !== 'All Categories' && (
                                                        <span className="ml-1 text-[10px] opacity-70">
                                                            ({count})
                                                        </span>
                                                    )}
                                                </Badge>
                                            );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </div>

                                <div className="space-y-2">
                                    <Label>Template</Label>
                                    <Select
                                        value={formData.templateId}
                                        onValueChange={(val) => {
                                            if (val === 'scratch') {
                                                setFormData({
                                                    ...formData,
                                                    templateId: '',
                                                    message: ''
                                                });
                                            } else {
                                                const tmpl = templates.find(t => t.id === val);
                                                setFormData({
                                                    ...formData,
                                                    templateId: val,
                                                    message: tmpl?.body || formData.message
                                                });
                                            }
                                        }}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Choose a template..." /></SelectTrigger>
                                        <SelectContent className="max-h-[300px]">
                                            <SelectItem value="scratch">
                                                <span className="flex items-center gap-2">
                                                    <span className="text-muted-foreground">✏️</span>
                                                    Start from Scratch
                                                </span>
                                            </SelectItem>
                                            {selectedCategory === 'All Categories' ? (
                                                // Group templates by category when showing all
                                                Object.entries(
                                                    templates.reduce((acc, t) => {
                                                        const cat = t.category || 'General';
                                                        if (!acc[cat]) acc[cat] = [];
                                                        acc[cat].push(t);
                                                        return acc;
                                                    }, {} as Record<string, typeof templates>)
                                                ).sort(([a], [b]) => a.localeCompare(b)).map(([category, categoryTemplates]) => (
                                                    <div key={category}>
                                                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
                                                            {category} ({categoryTemplates.length})
                                                        </div>
                                                        {categoryTemplates.map(t => (
                                                            <SelectItem key={t.id} value={t.id}>
                                                                <span className="flex items-center gap-2">
                                                                    {t.name}
                                                                    {t.is_system && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">System</Badge>}
                                                                </span>
                                                            </SelectItem>
                                                        ))}
                                                    </div>
                                                ))
                                            ) : (
                                                // Show templates for selected category
                                                templates
                                                    .filter(t => (t.category || 'General') === selectedCategory)
                                                    .map(t => (
                                                        <SelectItem key={t.id} value={t.id}>
                                                            <span className="flex items-center gap-2">
                                                                {t.name}
                                                                {t.is_system && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">System</Badge>}
                                                            </span>
                                                        </SelectItem>
                                                    ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col gap-2 min-h-0">
                                <Label>Message Body</Label>
                                <Textarea
                                    className="flex-1 resize-none font-mono text-sm"
                                    placeholder="Type your message here..."
                                    value={formData.message}
                                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {['{name}', '{city}', '{points_balance}', '{short_link}'].map(v => (
                                    <Button key={v} variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={() => insertVariable(v)}>{v}</Button>
                                ))}
                            </div>
                            <Button variant="outline" onClick={handleTestSend} disabled={testing}>
                                {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                                Send Test Message
                            </Button>
                        </div>

                        {/* Preview */}
                        <div className="bg-gray-100 rounded-xl p-4 flex justify-center items-center">
                            <div className="bg-white rounded-lg shadow-lg w-[300px] overflow-hidden border">
                                <div className="bg-[#075e54] text-white p-3 text-sm font-medium flex items-center gap-2">
                                    <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
                                    Serapod2u
                                </div>
                                <div className="bg-[#e5ddd5] h-[350px] p-4 flex flex-col gap-2 overflow-y-auto bg-opacity-30">
                                    <div className="bg-white p-2 rounded-lg rounded-tl-none shadow-sm text-sm self-start max-w-[90%] whitespace-pre-wrap">
                                        {formData.message || <span className="text-gray-400 italic">Message preview...</span>}
                                        <div className="text-[10px] text-gray-400 text-right mt-1">{format(new Date(), 'HH:mm')}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 4: Review */}
                {step === 4 && (
                    <div className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                                    <h4 className="font-medium text-sm text-gray-900 border-b pb-2">Campaign Summary</h4>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Name</span>
                                        <span className="font-medium">{formData.name}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Recipients</span>
                                        <span className="font-medium">{estimatedRecipients.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Objective</span>
                                        <Badge variant="outline">{formData.objective}</Badge>
                                    </div>
                                </div>

                                {/* Template Safety Badge */}
                                {messageSafety && (
                                    <div className={`p-4 rounded-lg border ${
                                        messageSafety.riskScore >= 80 
                                            ? 'bg-red-50 border-red-200' 
                                            : messageSafety.riskScore >= 50 
                                                ? 'bg-amber-50 border-amber-200' 
                                                : 'bg-green-50 border-green-200'
                                    }`}>
                                        <div className="flex items-center gap-2 mb-2">
                                            {messageSafety.riskScore >= 80 ? (
                                                <ShieldX className="w-5 h-5 text-red-500" />
                                            ) : messageSafety.riskScore >= 50 ? (
                                                <ShieldAlert className="w-5 h-5 text-amber-500" />
                                            ) : (
                                                <ShieldCheck className="w-5 h-5 text-green-500" />
                                            )}
                                            <h4 className="font-medium text-sm">
                                                Message Safety: {getRiskBadgeLabel(getRiskLevel(messageSafety.riskScore))}
                                            </h4>
                                            <Badge 
                                                variant="outline" 
                                                className={`ml-auto ${getRiskBadgeColor(getRiskLevel(messageSafety.riskScore))}`}
                                            >
                                                Score: {messageSafety.riskScore}
                                            </Badge>
                                        </div>
                                        
                                        {messageSafety.riskScore >= 80 && (
                                            <p className="text-xs text-red-700 mb-2">
                                                ⛔ This message cannot be sent due to critical safety issues.
                                            </p>
                                        )}
                                        
                                        {messageSafety.errors.length > 0 && (
                                            <div className="space-y-1 mb-2">
                                                {messageSafety.errors.map((e, i) => (
                                                    <p key={i} className="text-xs text-red-600">❌ {e.message}</p>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {messageSafety.warnings.length > 0 && messageSafety.riskScore < 80 && (
                                            <div className="space-y-1">
                                                {messageSafety.warnings.map((w, i) => (
                                                    <p key={i} className="text-xs text-amber-700">⚠️ {w.message}</p>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {/* Acknowledge checkbox for medium risk */}
                                        {messageSafety.riskScore >= 50 && messageSafety.riskScore < 80 && (
                                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-amber-200">
                                                <Checkbox 
                                                    id="acknowledge-risk"
                                                    checked={acknowledgeRisk}
                                                    onCheckedChange={(checked) => setAcknowledgeRisk(checked === true)}
                                                />
                                                <label htmlFor="acknowledge-risk" className="text-xs text-amber-800 cursor-pointer">
                                                    I understand the risks and want to proceed with this campaign
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangle className={`w-4 h-4 ${riskLevel === 'High' ? 'text-red-500' : 'text-yellow-500'}`} />
                                        <h4 className="font-medium text-sm">Audience Size: {riskLevel}</h4>
                                    </div>
                                    <p className="text-xs text-yellow-700">
                                        {riskLevel === 'High'
                                            ? 'Large audience size. Sending may take several hours due to throttling.'
                                            : 'Standard campaign load. Expected delivery within 1 hour.'}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="font-medium">Schedule</h4>
                                <div className="flex gap-4">
                                    <Button
                                        variant={formData.scheduleType === 'now' ? 'default' : 'outline'}
                                        onClick={() => setFormData({ ...formData, scheduleType: 'now' })}
                                        className="flex-1"
                                    >
                                        <Send className="w-4 h-4 mr-2" /> Send Now
                                    </Button>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={formData.scheduleType === 'schedule' ? 'default' : 'outline'}
                                                onClick={() => setFormData({ ...formData, scheduleType: 'schedule' })}
                                                className="flex-1"
                                            >
                                                <CalendarIcon className="w-4 h-4 mr-2" /> Schedule
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar
                                                mode="single"
                                                selected={formData.scheduledDate}
                                                onSelect={(d) => setFormData({ ...formData, scheduledDate: d, scheduleType: 'schedule' })}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                {formData.scheduleType === 'schedule' && formData.scheduledDate && (
                                    <p className="text-sm text-center text-primary font-medium">
                                        Scheduled for {format(formData.scheduledDate, 'PPP')}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
            {/* Sticky bottom action bar - always visible */}
            <div className="sticky bottom-0 p-6 border-t bg-gray-50 flex justify-between rounded-b-lg shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <Button variant="outline" onClick={step === 1 ? onCancel : handleBack}>
                    {step === 1 ? 'Cancel' : 'Back'}
                </Button>
                {step < 4 ? (
                    <Button onClick={handleNext} size="lg" className="px-6 shadow-sm">
                        Next Step <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                ) : (
                    <Button 
                        onClick={handleLaunch} 
                        disabled={submitting || (messageSafety?.riskScore ?? 0) >= 80 || ((messageSafety?.riskScore ?? 0) >= 50 && !acknowledgeRisk)} 
                        size="lg" 
                        className="px-6 shadow-sm"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                        {(messageSafety?.riskScore ?? 0) >= 80 ? 'Blocked' : 'Launch Campaign'}
                    </Button>
                )}
            </div>
        </Card>
    );
}
