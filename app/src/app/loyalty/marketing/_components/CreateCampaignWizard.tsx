'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Send, Save, AlertTriangle, Users, Calendar as CalendarIcon, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

type WizardProps = {
    onCancel: () => void;
    onComplete: () => void;
};

export function CreateCampaignWizard({ onCancel, onComplete }: WizardProps) {
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [testing, setTesting] = useState(false);
    
    const [formData, setFormData] = useState({
        name: '',
        objective: 'Promo',
        userType: 'all',
        location: 'any',
        message: '',
        scheduleType: 'now',
        scheduledDate: undefined as Date | undefined,
        quietHours: true
    });

    const steps = [
        { num: 1, label: 'Objective' },
        { num: 2, label: 'Audience' },
        { num: 3, label: 'Message' },
        { num: 4, label: 'Review' }
    ];

    const handleTestSend = async () => {
        if (!formData.message) {
            toast({ title: "Error", description: "Please enter a message first.", variant: "destructive" });
            return;
        }
        setTesting(true);
        try {
            const res = await fetch('/api/marketing/test-send', {
                method: 'POST',
                body: JSON.stringify({
                    message: formData.message,
                    // In a real app, send to current user's phone.
                    // Here we let the API determine the phone or just mock it.
                    phone: '0123456789' 
                })
            });
            if (res.ok) {
                toast({ title: "Sent", description: "Test message sent successfully." });
            } else {
                toast({ title: "Error", description: "Failed to send test message.", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Network error.", variant: "destructive" });
        } finally {
            setTesting(false);
        }
    };

    const handleLaunch = async () => {
        setSubmitting(true);
        try {
            const payload = {
                name: formData.name,
                objective: formData.objective,
                audienceFilters: {
                    userType: formData.userType,
                    location: formData.location
                },
                messageBody: formData.message,
                scheduledAt: formData.scheduleType === 'later' ? formData.scheduledDate : null,
                quietHoursEnabled: formData.quietHours
            };

            const res = await fetch('/api/marketing/campaigns', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                toast({ title: "Success", description: "Campaign created successfully!" });
                onComplete();
            } else {
                const err = await res.json();
                toast({ title: "Error", description: err.message || "Failed to create campaign", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Network error", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="max-w-4xl mx-auto">
            <CardHeader className="border-b bg-gray-50/50">
                <div className="flex justify-between items-center mb-6">
                    <CardTitle>Create New Campaign</CardTitle>
                    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                </div>
                
                <div className="flex justify-between relative px-4">
                    <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-200 -z-10 -translate-y-1/2 mx-8" />
                    {steps.map(s => (
                        <div key={s.num} className="flex flex-col items-center gap-2 bg-gray-50 px-2 box-border">
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                                 step >= s.num ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-500'
                             }`}>
                                 {s.num}
                             </div>
                             <span className={`text-xs font-medium ${step >= s.num ? 'text-blue-700' : 'text-gray-500'}`}>{s.label}</span>
                        </div>
                    ))}
                </div>
            </CardHeader>
            
            <CardContent className="py-8 min-h-[400px]">
                {step === 1 && (
                    <div className="space-y-6 max-w-lg mx-auto">
                        <div className="space-y-2">
                            <Label>Campaign Name</Label>
                            <Input 
                                placeholder="e.g. Feb 2026 Sale Announcement" 
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Campaign Objective</Label>
                            <Select 
                                value={formData.objective} 
                                onValueChange={val => setFormData({...formData, objective: val})}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Promo">Promotional Offer</SelectItem>
                                    <SelectItem value="Announcement">General Announcement</SelectItem>
                                    <SelectItem value="Winback">Customer Winback</SelectItem>
                                    <SelectItem value="Event">Event Invitation</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6 max-w-lg mx-auto">
                        <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
                             <div className="flex items-center gap-2 text-blue-800 font-medium mb-2">
                                 <Users className="w-4 h-4" /> Audience Estimate
                             </div>
                             <div className="text-2xl font-bold text-blue-900">1,248 Recipients</div>
                             <p className="text-sm text-blue-700 mt-1">Based on current filters.</p>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>User Type</Label>
                                <Select value={formData.userType} onValueChange={v => setFormData({...formData, userType: v})}>
                                    <SelectTrigger><SelectValue placeholder="All Users" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Users</SelectItem>
                                        <SelectItem value="shop">Shops Only</SelectItem>
                                        <SelectItem value="consumer">End Users Only</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Location</Label>
                                <Select value={formData.location} onValueChange={v => setFormData({...formData, location: v})}>
                                    <SelectTrigger><SelectValue placeholder="Any Location" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any">Any Location</SelectItem>
                                        <SelectItem value="kl">Kuala Lumpur</SelectItem>
                                        <SelectItem value="selangor">Selangor</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <Label>Message Content</Label>
                                <Button variant="link" className="h-auto p-0 text-xs">Load Template</Button>
                            </div>
                            <Textarea 
                                className="min-h-[250px] font-mono"
                                placeholder="Hello {name}, ..."
                                value={formData.message}
                                onChange={e => setFormData({...formData, message: e.target.value})}
                            />
                            <div className="text-xs text-gray-500">
                                Variables: {'{name}, {city}, {points}'}
                            </div>
                            
                            <div className="bg-amber-50 p-3 rounded text-xs text-amber-800 border border-amber-200 flex gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <div>
                                    <strong>Compliance Check:</strong> Avoid using ALL CAPS or excessive emojis to prevent blocking.
                                </div>
                            </div>
                        </div>
                        
                        {/* Preview */}
                        <div className="bg-gray-100 rounded-xl p-4 flex flex-col items-center justify-center">
                            <div className="w-full max-w-xs bg-[#e5ddd5] rounded-lg shadow-md overflow-hidden min-h-[300px] flex flex-col">
                                <div className="bg-[#075e54] h-12 w-full flex items-center px-4 text-white text-sm font-medium">
                                    WhatsApp Preview
                                </div>
                                <div className="p-4 flex-1">
                                    <div className="bg-white p-2 rounded-lg rounded-tl-none shadow-sm text-sm max-w-[85%] relative mb-2 break-words whitespace-pre-wrap">
                                        {formData.message || <span className="text-gray-400 italic">Type your message...</span>}
                                        <div className="text-[10px] text-gray-400 text-right mt-1">10:42 AM</div>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-4 w-full max-w-xs">
                                <Button variant="outline" className="w-full text-xs" onClick={handleTestSend} disabled={testing}>
                                    {testing ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Send className="w-3 h-3 mr-2" />}
                                    Test Send to My Number
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
                
                {step === 4 && (
                    <div className="max-w-lg mx-auto space-y-6">
                        <div className="space-y-2">
                            <Label className="text-base font-semibold">Schedule</Label>
                            <div className="flex items-center gap-4 p-4 border rounded-lg">
                                <div className="flex items-center gap-2">
                                    <Switch 
                                        checked={formData.scheduleType === 'later'} 
                                        onCheckedChange={c => setFormData({...formData, scheduleType: c ? 'later' : 'now'})}
                                    />
                                    <span>Schedule for later</span>
                                </div>
                                
                                {formData.scheduleType === 'later' && (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {formData.scheduledDate ? format(formData.scheduledDate, "PPP") : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar 
                                                mode="single" 
                                                selected={formData.scheduledDate} 
                                                onSelect={(d) => d && setFormData({...formData, scheduledDate: d})} 
                                                initialFocus 
                                            />
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        </div>

                         <div className="bg-green-50 p-4 rounded-lg border border-green-200 space-y-2">
                            <h4 className="font-semibold text-green-900 flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Estimated Duration
                            </h4>
                            <p className="text-sm text-green-800">
                                Sending to 1,248 recipients at ~20 msgs/min will take approx <strong>62 minutes</strong>.
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                                <Switch checked={formData.quietHours} onCheckedChange={(c) => setFormData({...formData, quietHours: c})} />
                                <span className="text-sm text-green-900">Respect Quiet Hours (10PM - 9AM)</span>
                            </div>
                         </div>
                    </div>
                )}
            </CardContent>

            <div className="p-6 border-t bg-gray-50 flex justify-between">
                <Button 
                    variant="outline" 
                    onClick={() => setStep(s => Math.max(1, s - 1))}
                    disabled={step === 1}
                >
                    Back
                </Button>
                
                {step < 4 ? (
                     <Button onClick={() => setStep(s => Math.min(4, s + 1))}>
                        Next Step
                    </Button>
                ) : (
                    <Button 
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleLaunch}
                        disabled={submitting}
                    >
                        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {formData.scheduleType === 'later' ? 'Schedule Campaign' : 'Launch Now'}
                    </Button>
                )}
            </div>
        </Card>
    )
}
