'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "../../../../components/ui/card";
import { Label } from "../../../../components/ui/label";
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import { Slider } from "../../../../components/ui/slider";
import { Button } from "../../../../components/ui/button";
import { Separator } from "../../../../components/ui/separator";
import { Info, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useToast } from "../../../../components/ui/use-toast";

export function SafetyComplianceSettings() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        throttle_per_minute: 20,
        jitter_seconds_min: 1,
        jitter_seconds_max: 3,
        auto_pause_failure_rate: 15,
        content_max_links: 1,
        content_max_length: 1000,
        quiet_hours_enabled: true
    });

    useEffect(() => {
        fetch('/api/wa/marketing/settings')
            .then(res => res.json())
            .then(data => {
                setSettings(prev => ({...prev, ...data}));
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/wa/marketing/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            if (res.ok) {
                toast({ title: "Settings Saved", description: "Safety settings have been updated." });
            } else {
                toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div>Loading settings...</div>;

    return (
        <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-6">
                 {/* Best Practices Box */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <span className="font-semibold block mb-1">Why these safeguards exist</span>
                        WhatsApp imposes strict limits on marketing messages. Exceeding rate limits or high block rates will downgrade your phone number quality rating and eventually lead to a ban. These settings help keep your account healthy.
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-green-600" />
                            Delivery Safeguards
                        </CardTitle>
                        <CardDescription>Control how fast messages are sent to avoid blocks.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <Label>Throttle (messages per minute)</Label>
                                <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">{settings.throttle_per_minute} / min</span>
                            </div>
                            <Slider 
                                value={[settings.throttle_per_minute]} 
                                min={5} 
                                max={60} 
                                step={5}
                                onValueChange={(v) => setSettings({...settings, throttle_per_minute: v[0]})}
                            />
                            <p className="text-xs text-gray-500">Recommended: 20-30 per minute for most numbers.</p>
                        </div>
                        
                        <Separator />

                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <Label>Random Jitter Delay (seconds)</Label>
                                <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">{settings.jitter_seconds_min}s - {settings.jitter_seconds_max}s</span>
                            </div>
                            <div className="flex gap-4 items-center">
                                <Input 
                                    type="number" 
                                    className="w-20" 
                                    value={settings.jitter_seconds_min} 
                                    onChange={e => setSettings({...settings, jitter_seconds_min: Number(e.target.value)})}
                                />
                                <span>to</span>
                                <Input 
                                    type="number" 
                                    className="w-20" 
                                    value={settings.jitter_seconds_max} 
                                    onChange={e => setSettings({...settings, jitter_seconds_max: Number(e.target.value)})}
                                />
                            </div>
                            <p className="text-xs text-gray-500">Adds random delay between messages to behave more human-like.</p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                         <CardTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-orange-500" />
                            Risk Prevention
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label>Auto-pause on High Failure Rate</Label>
                                <p className="text-xs text-gray-500">Pause campaign if &gt; {settings.auto_pause_failure_rate}% fail</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input 
                                    type="number" 
                                    className="w-20" 
                                    value={settings.auto_pause_failure_rate}
                                    onChange={e => setSettings({...settings, auto_pause_failure_rate: Number(e.target.value)})}
                                />
                                <span className="text-sm">%</span>
                            </div>
                        </div>

                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label>Content Health Check</Label>
                                <p className="text-xs text-gray-500">Warn if message contains too many links</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">Max Links:</span>
                                <Input 
                                    type="number" 
                                    className="w-16" 
                                    value={settings.content_max_links}
                                    onChange={e => setSettings({...settings, content_max_links: Number(e.target.value)})}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="w-full md:w-80">
                <Card className="sticky top-4">
                    <CardHeader>
                        <CardTitle className="text-sm uppercase text-gray-500">Global Rules</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label>Quiet Hours</Label>
                                <p className="text-xs text-gray-500">10 PM - 9 AM</p>
                            </div>
                            <Switch checked={true} disabled />
                        </div>
                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label>Opt-Out</Label>
                                <p className="text-xs text-gray-500">Strict Enforcement</p>
                            </div>
                            <Switch checked={true} disabled />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Settings'}
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
