'use client';

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronDown, ChevronUp, Coins, Activity } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";

export interface AudienceFilters {
    organization_type: string;
    state: string;
    opt_in_only: boolean;
    only_valid_whatsapp: boolean;
    // Point-based filters
    points_min?: number | null;
    points_max?: number | null;
    collected_system_min?: number | null;
    collected_system_max?: number | null;
    collected_manual_min?: number | null;
    collected_manual_max?: number | null;
    migration_points_min?: number | null;
    migration_points_max?: number | null;
    total_redeemed_min?: number | null;
    total_redeemed_max?: number | null;
    transactions_count_min?: number | null;
    transactions_count_max?: number | null;
    // Activity filters
    last_activity_after?: string | null;
    last_activity_before?: string | null;
    inactive_days?: number | null;
    never_scanned?: boolean;
}

interface AudienceFilterBuilderProps {
    filters: AudienceFilters;
    onChange: (filters: AudienceFilters) => void;
}

// Helper component for min/max range inputs
function RangeInput({ 
    label, 
    minValue, 
    maxValue, 
    onMinChange, 
    onMaxChange
}: { 
    label: string; 
    minValue?: number | null; 
    maxValue?: number | null; 
    onMinChange: (v: number | null) => void; 
    onMaxChange: (v: number | null) => void;
}) {
    return (
        <div className="space-y-2">
            <Label className="text-sm font-medium">{label}</Label>
            <div className="flex items-center gap-2">
                <Input 
                    type="number" 
                    placeholder="Min"
                    value={minValue ?? ''}
                    onChange={(e) => onMinChange(e.target.value ? Number(e.target.value) : null)}
                    className="w-24"
                />
                <span className="text-muted-foreground">to</span>
                <Input 
                    type="number" 
                    placeholder="Max"
                    value={maxValue ?? ''}
                    onChange={(e) => onMaxChange(e.target.value ? Number(e.target.value) : null)}
                    className="w-24"
                />
            </div>
        </div>
    );
}

export function AudienceFilterBuilder({ filters, onChange }: AudienceFilterBuilderProps) {
    const [orgTypes, setOrgTypes] = useState<string[]>([]);
    const [states, setStates] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [pointFiltersOpen, setPointFiltersOpen] = useState(false);
    const [activityFiltersOpen, setActivityFiltersOpen] = useState(false);

    useEffect(() => {
        Promise.all([
            fetch('/api/wa/marketing/audience/org-types').then(r => r.json()),
            fetch('/api/wa/marketing/audience/states').then(r => r.json())
        ]).then(([orgData, stateData]) => {
            const types = new Set<string>((orgData.organization_types as string[]) || []);
            types.add('End User');
            setOrgTypes(Array.from(types).sort());

            setStates((stateData.states as string[]) || []);
            setLoading(false);
        }).catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, []);

    const handleChange = <K extends keyof AudienceFilters>(key: K, value: AudienceFilters[K]) => {
        onChange({ ...filters, [key]: value });
    };

    // Check if any point filters are active
    const hasPointFilters = filters.points_min != null || filters.points_max != null ||
        filters.collected_system_min != null || filters.collected_system_max != null ||
        filters.collected_manual_min != null || filters.collected_manual_max != null ||
        filters.migration_points_min != null || filters.migration_points_max != null ||
        filters.total_redeemed_min != null || filters.total_redeemed_max != null ||
        filters.transactions_count_min != null || filters.transactions_count_max != null;

    // Check if any activity filters are active
    const hasActivityFilters = filters.last_activity_after != null || filters.last_activity_before != null ||
        filters.inactive_days != null || filters.never_scanned === true;

    if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading options...</div>;

    return (
        <div className="space-y-6">
            {/* Basic Filters */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label>Organization Type</Label>
                    <Select
                        value={filters.organization_type}
                        onValueChange={(v) => handleChange('organization_type', v)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Organization Types</SelectItem>
                            {orgTypes.map(type => (
                                <SelectItem key={type} value={type}>{type}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>Location (State)</Label>
                    <Select
                        value={filters.state}
                        onValueChange={(v) => handleChange('state', v)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select Location" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="any">Any Location</SelectItem>
                            {states.map(state => (
                                <SelectItem key={state} value={state}>{state}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Point-Based Filters (Collapsible) */}
            <Collapsible open={pointFiltersOpen} onOpenChange={setPointFiltersOpen}>
                <Card className="p-0 overflow-hidden">
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2">
                            <Coins className="w-4 h-4 text-amber-500" />
                            <span className="font-medium">Point-Based Filters</span>
                            {hasPointFilters && (
                                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">Active</span>
                            )}
                        </div>
                        {pointFiltersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div className="p-4 pt-0 space-y-4 border-t">
                            <RangeInput
                                label="Current Balance"
                                minValue={filters.points_min}
                                maxValue={filters.points_max}
                                onMinChange={(v) => handleChange('points_min', v)}
                                onMaxChange={(v) => handleChange('points_max', v)}
                            />
                            <RangeInput
                                label="Collected (QR Scans)"
                                minValue={filters.collected_system_min}
                                maxValue={filters.collected_system_max}
                                onMinChange={(v) => handleChange('collected_system_min', v)}
                                onMaxChange={(v) => handleChange('collected_system_max', v)}
                            />
                            <RangeInput
                                label="Collected (Manual)"
                                minValue={filters.collected_manual_min}
                                maxValue={filters.collected_manual_max}
                                onMinChange={(v) => handleChange('collected_manual_min', v)}
                                onMaxChange={(v) => handleChange('collected_manual_max', v)}
                            />
                            <RangeInput
                                label="Migration Points"
                                minValue={filters.migration_points_min}
                                maxValue={filters.migration_points_max}
                                onMinChange={(v) => handleChange('migration_points_min', v)}
                                onMaxChange={(v) => handleChange('migration_points_max', v)}
                            />
                            <RangeInput
                                label="Total Redeemed"
                                minValue={filters.total_redeemed_min}
                                maxValue={filters.total_redeemed_max}
                                onMinChange={(v) => handleChange('total_redeemed_min', v)}
                                onMaxChange={(v) => handleChange('total_redeemed_max', v)}
                            />
                            <RangeInput
                                label="Transaction Count"
                                minValue={filters.transactions_count_min}
                                maxValue={filters.transactions_count_max}
                                onMinChange={(v) => handleChange('transactions_count_min', v)}
                                onMaxChange={(v) => handleChange('transactions_count_max', v)}
                            />
                        </div>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Activity Filters (Collapsible) */}
            <Collapsible open={activityFiltersOpen} onOpenChange={setActivityFiltersOpen}>
                <Card className="p-0 overflow-hidden">
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-blue-500" />
                            <span className="font-medium">Activity Filters</span>
                            {hasActivityFilters && (
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">Active</span>
                            )}
                        </div>
                        {activityFiltersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div className="p-4 pt-0 space-y-4 border-t">
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Last Activity Date Range</Label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        type="date" 
                                        value={filters.last_activity_after ?? ''}
                                        onChange={(e) => handleChange('last_activity_after', e.target.value || null)}
                                        className="w-36"
                                    />
                                    <span className="text-muted-foreground">to</span>
                                    <Input 
                                        type="date" 
                                        value={filters.last_activity_before ?? ''}
                                        onChange={(e) => handleChange('last_activity_before', e.target.value || null)}
                                        className="w-36"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Inactive for X Days</Label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        type="number" 
                                        placeholder="e.g. 30"
                                        value={filters.inactive_days ?? ''}
                                        onChange={(e) => handleChange('inactive_days', e.target.value ? Number(e.target.value) : null)}
                                        className="w-24"
                                    />
                                    <span className="text-muted-foreground text-sm">days</span>
                                </div>
                            </div>

                            <div className="flex items-center space-x-2 py-2">
                                <Switch
                                    checked={filters.never_scanned ?? false}
                                    onCheckedChange={(c) => handleChange('never_scanned', c)}
                                    id="never-scanned"
                                />
                                <Label htmlFor="never-scanned" className="font-normal cursor-pointer">
                                    Never scanned a QR code (collected_system = 0)
                                </Label>
                            </div>
                        </div>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Delivery Toggles */}
            <div className="space-y-3 pt-2">
                <div className="flex items-center space-x-2">
                    <Switch
                        checked={filters.opt_in_only ?? true}
                        onCheckedChange={(c) => handleChange('opt_in_only', c)}
                        id="opt-in"
                    />
                    <Label htmlFor="opt-in" className="font-normal cursor-pointer">
                        Only send to opted-in users (Strongly Recommended)
                    </Label>
                </div>

                <div className="flex items-center space-x-2">
                    <Switch
                        checked={filters.only_valid_whatsapp ?? true}
                        onCheckedChange={(c) => handleChange('only_valid_whatsapp', c)}
                        id="valid-wa"
                    />
                    <Label htmlFor="valid-wa" className="font-normal cursor-pointer">
                        Only valid WhatsApp numbers
                    </Label>
                </div>
            </div>
        </div>
    );
}
