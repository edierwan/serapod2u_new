'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Send, Save, AlertTriangle, Users, Calendar as CalendarIcon, Clock, Smartphone, ChevronRight, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AudienceFilterBuilder } from './AudienceFilterBuilder';
import { AudienceEstimator } from './AudienceEstimator';
import { SpecificUserSelector } from './SpecificUserSelector';

type WizardProps = {
    onCancel: () => void;
    onComplete: () => void;
};

export function CreateCampaignWizard({ onCancel, onComplete }: WizardProps) {
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [estimatedRecipients, setEstimatedRecipients] = useState(0);
    
    const [segments, setSegments] = useState<any[]>([]);

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
            opt_in_only: true
        },

        message: '',
        templateId: '',
        scheduleType: 'now',
        scheduledDate: undefined as Date | undefined,
        quietHours: true
    });

    useEffect(() => {
        fetch('/api/wa/marketing/segments')
            .then(r => r.json())
            .then(d => setSegments(Array.isArray(d) ? d : []))
            .catch(console.error);
    }, []);

    const steps = [
        { num: 1, label: 'Objective' },
        { num: 2, label: 'Audience' },
        { num: 3, label: 'Message' },
        { num: 4, label: 'Review' }
    ];

    const mockTemplates = [
        { id: '1', name: 'Start from Scratch', body: '' },
        { id: '2', name: 'Standard Promo', body: 'Hi {name}, huge sale today! {short_link}' },
        { id: '3', name: 'Points Reminder', body: 'You have {points_balance} points expiring soon.' }
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
        setSubmitting(true);
        try {
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
                toast({ title: "Success", description: "Campaign created successfully!" });
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

    return (
        <Card className="w-full border shadow-sm">
            <CardHeader>
                <div className="flex justify-between items-center mb-8">
                    <CardTitle className="text-xl">Create New Campaign</CardTitle>
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
            <CardContent className="pt-8 min-h-[500px]">
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
                                    onChange={e => setFormData({...formData, name: e.target.value})}
                                />
                                <p className="text-sm text-gray-500">Give your campaign a descriptive name for internal tracking.</p>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-base">Objective</Label>
                                <Select value={formData.objective} onValueChange={v => setFormData({...formData, objective: v})}>
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
                    <div className="grid md:grid-cols-2 gap-8 h-[500px]">
                        <div className="space-y-4 flex flex-col h-full">
                            <h3 className="font-medium">Define Audience</h3>
                            
                            <div className="space-y-2">
                                <Label>Audience Source</Label>
                                <Tabs value={formData.audienceMode} onValueChange={(v: any) => setFormData({...formData, audienceMode: v})} className="w-full">
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
                                        onChange={(f) => setFormData({...formData, filters: f})} 
                                     />
                                )}
                                
                                {formData.audienceMode === 'segment' && (
                                    <div className="space-y-2 pt-2">
                                        <Label>Select Segment</Label>
                                        <Select 
                                            value={formData.selectedSegmentId} 
                                            onValueChange={(v) => setFormData({...formData, selectedSegmentId: v})}
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
                                        onSelect={(ids) => setFormData({...formData, selectedUserIds: ids})}
                                    />
                                )}
                            </ScrollArea>
                        </div>
                        
                        <div className="h-full">
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
                        <div className="flex flex-col gap-4 h-full">
                            <div className="space-y-2">
                                <Label>Template</Label>
                                <Select 
                                    value={formData.templateId} 
                                    onValueChange={(val) => {
                                        const tmpl = mockTemplates.find(t => t.id === val);
                                        setFormData({
                                            ...formData, 
                                            templateId: val,
                                            message: tmpl?.body || formData.message
                                        });
                                    }}
                                >
                                    <SelectTrigger><SelectValue placeholder="Choose a template..." /></SelectTrigger>
                                    <SelectContent>
                                        {mockTemplates.map(t => (
                                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex-1 flex flex-col gap-2">
                                <Label>Message Body</Label>
                                <Textarea 
                                    className="flex-1 resize-none font-mono text-sm" 
                                    placeholder="Type your message here..."
                                    value={formData.message}
                                    onChange={e => setFormData({...formData, message: e.target.value})}
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

                                <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangle className={`w-4 h-4 ${riskLevel === 'High' ? 'text-red-500' : 'text-yellow-500'}`} />
                                        <h4 className="font-medium text-sm">Risk Assessment: {riskLevel}</h4>
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
                                        onClick={() => setFormData({...formData, scheduleType: 'now'})}
                                        className="flex-1"
                                    >
                                        <Send className="w-4 h-4 mr-2" /> Send Now
                                    </Button>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button 
                                                variant={formData.scheduleType === 'schedule' ? 'default' : 'outline'}
                                                onClick={() => setFormData({...formData, scheduleType: 'schedule'})}
                                                className="flex-1"
                                            >
                                                <CalendarIcon className="w-4 h-4 mr-2" /> Schedule
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar
                                                mode="single"
                                                selected={formData.scheduledDate}
                                                onSelect={(d) => setFormData({...formData, scheduledDate: d, scheduleType: 'schedule'})}
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
            <div className="p-6 border-t bg-gray-50 flex justify-between rounded-b-lg">
                <Button variant="outline" onClick={step === 1 ? onCancel : handleBack}>
                    {step === 1 ? 'Cancel' : 'Back'}
                </Button>
                {step < 4 ? (
                    <Button onClick={handleNext}>Next Step <ChevronRight className="w-4 h-4 ml-2" /></Button>
                ) : (
                    <Button onClick={handleLaunch} disabled={submitting}>
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                        Launch Campaign
                    </Button>
                )}
            </div>
        </Card>
    );
}
