'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { 
    Loader2, 
    ShieldCheck, 
    ShieldAlert, 
    AlertTriangle, 
    Clock, 
    Users, 
    Activity, 
    Lightbulb, 
    Check, 
    X, 
    CalendarClock,
    Layers,
    Info,
    ArrowRight
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
    NumberHealth,
    SafetyPreset,
    recommendPreset,
    getSystemPreset,
    calculateEstimatedRuntime,
    formatRuntime,
    SYSTEM_PRESETS,
} from '@/lib/wa-safety';
import { TemplateSafetyResult } from '@/lib/template-safety.client';

// Types for pre-launch analysis
export interface PrelaunchAnalysis {
    recommendedPresetId: string;
    recommendedPresetName: string;
    reasons: string[];
    warnings: { code: string; message: string; severity: 'info' | 'warn' | 'block' }[];
    quietHours: { 
        enabled: boolean; 
        isBlockedNow: boolean; 
        nextAllowedAt?: string;
        currentTime: string;
    };
    estimated: {
        recipients: number;
        runtimeMinutesByPreset: Record<string, number>;
        recommendedRuntimeMinutes: number;
    };
    splitSuggestion?: {
        shouldSplit: boolean;
        recommendedBatchSize: number;
        estimatedBatches: number;
        reason: string;
    };
    enforce: {
        canLaunchNow: boolean;
        hardBlockReasons?: string[];
    };
    numberHealth: NumberHealth;
    messageSafetyScore: number;
}

interface PrelaunchAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    campaignName: string;
    recipientCount: number;
    objective: string;
    numberHealth: NumberHealth;
    messageSafety: TemplateSafetyResult | null;
    quietHoursEnabled: boolean;
    onConfirm: (config: {
        presetId: string;
        mode: 'send_now' | 'schedule';
        scheduledAt?: string;
        split?: { enabled: boolean; batchSize: number };
    }) => void;
    onCancel: () => void;
}

/**
 * Pre-Launch Safety Analysis Modal
 * Shows safety analysis and allows user to confirm/modify preset before launching
 */
export function PrelaunchAnalysisModal({
    open,
    onOpenChange,
    campaignName,
    recipientCount,
    objective,
    numberHealth,
    messageSafety,
    quietHoursEnabled,
    onConfirm,
    onCancel,
}: PrelaunchAnalysisModalProps) {
    const [loading, setLoading] = useState(true);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');
    const [splitEnabled, setSplitEnabled] = useState(false);
    const [batchSize, setBatchSize] = useState(400);
    const [analysis, setAnalysis] = useState<PrelaunchAnalysis | null>(null);
    const [launchMode, setLaunchMode] = useState<'send_now' | 'schedule'>('send_now');
    const [scheduledAt, setScheduledAt] = useState<string>('');

    // Run analysis when modal opens
    useEffect(() => {
        if (open) {
            runAnalysis();
        }
    }, [open]);

    const runAnalysis = async () => {
        setLoading(true);
        try {
            // Get recommendation
            const recommendation = recommendPreset({
                recipientCount,
                health: numberHealth,
            });

            // Calculate runtime for all presets
            const runtimeByPreset: Record<string, number> = {};
            SYSTEM_PRESETS.forEach(preset => {
                runtimeByPreset[preset.id] = calculateEstimatedRuntime(recipientCount, preset.settings);
            });

            // Build reasons
            const reasons: string[] = [];
            if (numberHealth.riskScore <= 20) {
                reasons.push(`Number health is excellent (risk score: ${numberHealth.riskScore}/100)`);
            } else if (numberHealth.riskScore <= 40) {
                reasons.push(`Number health is good (risk score: ${numberHealth.riskScore}/100)`);
            } else {
                reasons.push(`Number health needs attention (risk score: ${numberHealth.riskScore}/100)`);
            }
            
            reasons.push(`Audience size: ${recipientCount.toLocaleString()} recipients`);
            
            if (numberHealth.uptime24h >= 98) {
                reasons.push(`Excellent uptime: ${numberHealth.uptime24h}%`);
            }
            
            if (numberHealth.lastIssueRecency) {
                reasons.push(`Last issue: ${numberHealth.lastIssueRecency}`);
            }

            // Build warnings
            const warnings: { code: string; message: string; severity: 'info' | 'warn' | 'block' }[] = [];
            
            if (numberHealth.disconnects24h >= 3) {
                warnings.push({
                    code: 'DISCONNECTS_HIGH',
                    message: `${numberHealth.disconnects24h} disconnections in last 24 hours`,
                    severity: numberHealth.disconnects24h >= 5 ? 'warn' : 'info'
                });
            }
            
            if (recipientCount > 1000) {
                warnings.push({
                    code: 'LARGE_AUDIENCE',
                    message: 'Large audience - consider enabling batch splitting',
                    severity: 'info'
                });
            }
            
            if (messageSafety && messageSafety.riskScore >= 50) {
                warnings.push({
                    code: 'MESSAGE_RISK',
                    message: `Message has elevated risk score: ${messageSafety.riskScore}`,
                    severity: messageSafety.riskScore >= 80 ? 'block' : 'warn'
                });
            }

            // Quiet hours check (mock - in real app fetch from org settings)
            const now = new Date();
            const currentHour = now.getHours();
            const isQuietHours = quietHoursEnabled && (currentHour >= 21 || currentHour < 8);
            
            if (isQuietHours) {
                warnings.push({
                    code: 'QUIET_HOURS',
                    message: 'Currently in quiet hours (9PM-8AM). Messages will be held.',
                    severity: 'warn'
                });
            }

            // Split suggestion
            let splitSuggestion = undefined;
            if (recipientCount > 800) {
                const recommendedBatchSize = Math.min(400, Math.ceil(recipientCount / Math.ceil(recipientCount / 400)));
                splitSuggestion = {
                    shouldSplit: true,
                    recommendedBatchSize,
                    estimatedBatches: Math.ceil(recipientCount / recommendedBatchSize),
                    reason: 'Large audience increases complaint risk; batching reduces spike patterns.'
                };
            }

            // Enforcement
            const hardBlockReasons: string[] = [];
            if (messageSafety && messageSafety.riskScore >= 80) {
                hardBlockReasons.push('Message has critical safety issues');
            }
            if (numberHealth.riskScore > 60 && recipientCount > 500) {
                hardBlockReasons.push('Number health is too poor for this audience size');
            }

            const analysisResult: PrelaunchAnalysis = {
                recommendedPresetId: recommendation.presetId,
                recommendedPresetName: recommendation.presetName,
                reasons,
                warnings,
                quietHours: {
                    enabled: quietHoursEnabled,
                    isBlockedNow: isQuietHours,
                    nextAllowedAt: isQuietHours ? '8:00 AM' : undefined,
                    currentTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                },
                estimated: {
                    recipients: recipientCount,
                    runtimeMinutesByPreset: runtimeByPreset,
                    recommendedRuntimeMinutes: recommendation.estimatedRuntimeMinutes,
                },
                splitSuggestion,
                enforce: {
                    canLaunchNow: hardBlockReasons.length === 0 && !isQuietHours,
                    hardBlockReasons: hardBlockReasons.length > 0 ? hardBlockReasons : undefined,
                },
                numberHealth,
                messageSafetyScore: messageSafety?.riskScore ?? 0,
            };

            setAnalysis(analysisResult);
            setSelectedPresetId(recommendation.presetId);
            
            // Auto-enable split if suggested
            if (splitSuggestion?.shouldSplit) {
                setSplitEnabled(true);
                setBatchSize(splitSuggestion.recommendedBatchSize);
            }
            
            // Set launch mode based on quiet hours
            if (isQuietHours) {
                setLaunchMode('schedule');
            }
            
        } catch (error) {
            console.error('Analysis failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const selectedPreset = useMemo(() => {
        return SYSTEM_PRESETS.find(p => p.id === selectedPresetId);
    }, [selectedPresetId]);

    const currentRuntime = useMemo(() => {
        if (!analysis || !selectedPresetId) return 0;
        return analysis.estimated.runtimeMinutesByPreset[selectedPresetId] || 0;
    }, [analysis, selectedPresetId]);

    const isRecommendedPreset = selectedPresetId === analysis?.recommendedPresetId;

    const handleConfirm = () => {
        onConfirm({
            presetId: selectedPresetId,
            mode: launchMode,
            scheduledAt: launchMode === 'schedule' ? scheduledAt : undefined,
            split: splitEnabled ? { enabled: true, batchSize } : undefined,
        });
    };

    // Allow confirm if: not loading, has preset selected, and either can launch now OR scheduling during quiet hours
    const canConfirm = !loading && selectedPresetId && (
        analysis?.enforce.canLaunchNow || 
        (analysis?.quietHours.isBlockedNow && launchMode === 'schedule' && scheduledAt)
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        Safety Analysis Before Launch
                    </DialogTitle>
                    <DialogDescription>
                        Review safety recommendations for "{campaignName}"
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="ml-3 text-muted-foreground">Analyzing campaign safety...</span>
                    </div>
                ) : analysis && (
                    <div className="space-y-6">
                        {/* Summary Section */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <Users className="w-5 h-5 mx-auto mb-1 text-blue-600" />
                                <div className="text-lg font-semibold">{analysis.estimated.recipients.toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground">Recipients</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <Clock className="w-5 h-5 mx-auto mb-1 text-green-600" />
                                <div className="text-lg font-semibold">{formatRuntime(currentRuntime)}</div>
                                <div className="text-xs text-muted-foreground">Est. Runtime</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <Activity className="w-5 h-5 mx-auto mb-1 text-purple-600" />
                                <div className="text-lg font-semibold">{analysis.numberHealth.riskScore}/100</div>
                                <div className="text-xs text-muted-foreground">Risk Score</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <ShieldCheck className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                                <div className="text-lg font-semibold">{analysis.numberHealth.successRate}%</div>
                                <div className="text-xs text-muted-foreground">Success Rate</div>
                            </div>
                        </div>

                        {/* Hard Blocks */}
                        {analysis.enforce.hardBlockReasons && analysis.enforce.hardBlockReasons.length > 0 && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <X className="w-5 h-5 text-red-600" />
                                    <h4 className="font-medium text-red-800">Cannot Launch</h4>
                                </div>
                                <ul className="space-y-1">
                                    {analysis.enforce.hardBlockReasons.map((reason, i) => (
                                        <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                                            <span>•</span> {reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Recommendation Section */}
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Lightbulb className="w-5 h-5 text-blue-600" />
                                    <span className="font-medium text-blue-900">Recommended Preset:</span>
                                    <Badge variant="outline" className="bg-white border-blue-200">
                                        {analysis.recommendedPresetName}
                                    </Badge>
                                </div>
                            </div>
                            
                            <div className="space-y-1 text-sm text-blue-800">
                                {analysis.reasons.map((reason, i) => (
                                    <p key={i} className="flex items-start gap-2">
                                        <Check className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" />
                                        {reason}
                                    </p>
                                ))}
                            </div>
                        </div>

                        {/* Warnings */}
                        {analysis.warnings.length > 0 && (
                            <div className="space-y-2">
                                {analysis.warnings.map((warning, i) => (
                                    <div 
                                        key={i} 
                                        className={`flex items-start gap-2 p-3 rounded-lg border ${
                                            warning.severity === 'block' 
                                                ? 'bg-red-50 border-red-200 text-red-800'
                                                : warning.severity === 'warn'
                                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                                : 'bg-gray-50 border-gray-200 text-gray-700'
                                        }`}
                                    >
                                        {warning.severity === 'block' ? (
                                            <X className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        ) : warning.severity === 'warn' ? (
                                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        ) : (
                                            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        )}
                                        <span className="text-sm">{warning.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <Separator />

                        {/* Preset Selection */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">Select Preset</Label>
                            <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose a preset" />
                                </SelectTrigger>
                                <SelectContent>
                                    {SYSTEM_PRESETS.map(preset => (
                                        <SelectItem key={preset.id} value={preset.id}>
                                            <div className="flex items-center gap-2">
                                                {preset.name}
                                                {preset.id === analysis.recommendedPresetId && (
                                                    <Badge variant="secondary" className="text-xs">Recommended</Badge>
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            
                            {selectedPreset && (
                                <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
                            )}

                            {!isRecommendedPreset && (
                                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 p-2 rounded">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span>
                                        You selected a different preset. Runtime: {formatRuntime(currentRuntime)} 
                                        (vs {formatRuntime(analysis.estimated.recommendedRuntimeMinutes)} recommended)
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Split Suggestion */}
                        {analysis.splitSuggestion && (
                            <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Layers className="w-5 h-5 text-gray-600" />
                                        <Label htmlFor="split-toggle" className="font-medium cursor-pointer">
                                            Split into Batches
                                        </Label>
                                        {analysis.splitSuggestion.shouldSplit && (
                                            <Badge variant="outline" className="text-xs">Recommended</Badge>
                                        )}
                                    </div>
                                    <Switch
                                        id="split-toggle"
                                        checked={splitEnabled}
                                        onCheckedChange={setSplitEnabled}
                                    />
                                </div>
                                
                                {splitEnabled && (
                                    <div className="space-y-2 pl-7">
                                        <p className="text-xs text-muted-foreground">
                                            {analysis.splitSuggestion.reason}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <Label className="text-sm">Batch Size:</Label>
                                            <Input
                                                type="number"
                                                value={batchSize}
                                                onChange={(e) => setBatchSize(Math.max(50, parseInt(e.target.value) || 50))}
                                                className="w-24 h-8"
                                                min={50}
                                                max={1000}
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                = {Math.ceil(recipientCount / batchSize)} batches
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Launch Mode */}
                        {analysis.quietHours.isBlockedNow && (
                            <div className="space-y-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
                                <div className="flex items-center gap-2">
                                    <CalendarClock className="w-5 h-5 text-amber-600" />
                                    <span className="font-medium text-amber-800">Quiet Hours Active</span>
                                </div>
                                <p className="text-sm text-amber-700">
                                    Current time is {analysis.quietHours.currentTime}. Messages cannot be sent until {analysis.quietHours.nextAllowedAt}.
                                    Your campaign will be scheduled instead.
                                </p>
                                <div className="flex items-center gap-2 mt-3">
                                    <Label className="text-sm font-medium text-amber-800">Schedule for:</Label>
                                    <DateTimePicker 
                                        date={scheduledAt ? new Date(scheduledAt) : undefined}
                                        setDate={(d) => setScheduledAt(d ? d.toISOString() : '')}
                                        minDate={new Date()}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={onCancel}>
                        Back to Review
                    </Button>
                    <Button 
                        onClick={handleConfirm} 
                        disabled={!canConfirm}
                        className="gap-2"
                    >
                        {analysis?.quietHours.isBlockedNow ? (
                            <>
                                <CalendarClock className="w-4 h-4" />
                                Schedule Campaign
                            </>
                        ) : (
                            <>
                                <ArrowRight className="w-4 h-4" />
                                Confirm & Launch
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
