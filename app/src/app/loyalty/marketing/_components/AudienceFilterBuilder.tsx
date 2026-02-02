'use client';

import { useState, useEffect, useRef } from 'react';
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronUp, Coins, Activity, X, Check } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface AudienceFilters {
    organization_type: string;  // Legacy single select (kept for backward compatibility)
    organization_types?: string[];  // New multi-select
    state: string;  // Legacy single select
    states?: string[];  // New multi-select
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
    never_login?: boolean;
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
    const [orgTypeOpen, setOrgTypeOpen] = useState(false);
    const [locationOpen, setLocationOpen] = useState(false);

    // Get selected values (support both old single and new multi format)
    const selectedOrgTypes = filters.organization_types || 
        (filters.organization_type && filters.organization_type !== 'all' && filters.organization_type !== 'All' 
            ? [filters.organization_type] 
            : []);
    const selectedStates = filters.states || 
        (filters.state && filters.state !== 'any' && filters.state !== 'Any Location' 
            ? [filters.state] 
            : []);

    useEffect(() => {
        Promise.all([
            fetch('/api/wa/marketing/audience/org-types').then(r => r.json()).catch(() => ({ organization_types: [] })),
            fetch('/api/wa/marketing/audience/states').then(r => r.json()).catch(() => ({ states: [] }))
        ]).then(([orgData, stateData]) => {
            const rawTypes = (orgData?.organization_types as string[]) || [];
            const safeTypes = Array.isArray(rawTypes) 
                ? rawTypes.filter(t => typeof t === 'string' && t.length > 0) 
                : [];
            
            const types = new Set<string>(safeTypes);
            types.add('End User');
            setOrgTypes(Array.from(types).sort());

            const rawStates = (stateData?.states as string[]) || [];
            const safeStates = Array.isArray(rawStates)
                 ? rawStates.filter(s => typeof s === 'string' && s.length > 0)
                 : [];
            setStates(safeStates.sort());
            
            setLoading(false);
        }).catch(err => {
            console.error("Error loading filters:", err);
            setLoading(false);
        });
    }, []);

    const handleChange = <K extends keyof AudienceFilters>(key: K, value: AudienceFilters[K]) => {
        onChange({ ...filters, [key]: value });
    };

    const handleOrgTypeToggle = (type: string) => {
        const current = [...selectedOrgTypes];
        const index = current.indexOf(type);
        if (index > -1) {
            current.splice(index, 1);
        } else {
            current.push(type);
        }
        // Update both old and new format for compatibility
        onChange({ 
            ...filters, 
            organization_types: current,
            organization_type: current.length === 1 ? current[0] : (current.length === 0 ? 'all' : 'multiple')
        });
    };

    const handleStateToggle = (state: string) => {
        const current = [...selectedStates];
        const index = current.indexOf(state);
        if (index > -1) {
            current.splice(index, 1);
        } else {
            current.push(state);
        }
        // Update both old and new format for compatibility
        onChange({ 
            ...filters, 
            states: current,
            state: current.length === 1 ? current[0] : (current.length === 0 ? 'any' : 'multiple')
        });
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
        filters.inactive_days != null || filters.never_scanned === true || filters.never_login === true;

    if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading options...</div>;

    return (
        <div className="space-y-6">
            {/* Basic Filters */}
            <div className="space-y-4">
                {/* Multi-Select Organization Type */}
                <div className="space-y-2">
                    <Label>Organization Type</Label>
                    <Popover open={orgTypeOpen} onOpenChange={setOrgTypeOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={orgTypeOpen}
                                className="w-full justify-between font-normal"
                            >
                                {selectedOrgTypes.length === 0 
                                    ? "All Organization Types" 
                                    : selectedOrgTypes.length === 1
                                        ? selectedOrgTypes[0]
                                        : `${selectedOrgTypes.length} types selected`}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                            <Command>
                                <CommandInput placeholder="Search organization types..." />
                                <CommandList>
                                    <CommandEmpty>No types found.</CommandEmpty>
                                    <CommandGroup>
                                        {orgTypes.map((type) => (
                                            <CommandItem
                                                key={type}
                                                value={type}
                                                onSelect={() => handleOrgTypeToggle(type)}
                                            >
                                                <div className={cn(
                                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                    selectedOrgTypes.includes(type) 
                                                        ? "bg-primary text-primary-foreground" 
                                                        : "opacity-50"
                                                )}>
                                                    {selectedOrgTypes.includes(type) && <Check className="h-3 w-3" />}
                                                </div>
                                                {type}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                    {selectedOrgTypes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {selectedOrgTypes.map((type) => (
                                <Badge key={type} variant="secondary" className="text-xs">
                                    {type}
                                    <button
                                        className="ml-1 hover:text-destructive"
                                        onClick={() => handleOrgTypeToggle(type)}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>

                {/* Multi-Select Location */}
                <div className="space-y-2">
                    <Label>Location (State)</Label>
                    <Popover open={locationOpen} onOpenChange={setLocationOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={locationOpen}
                                className="w-full justify-between font-normal"
                            >
                                {selectedStates.length === 0 
                                    ? "Any Location" 
                                    : selectedStates.length === 1
                                        ? selectedStates[0]
                                        : `${selectedStates.length} locations selected`}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                            <Command>
                                <CommandInput placeholder="Search locations..." />
                                <CommandList>
                                    <CommandEmpty>No locations found.</CommandEmpty>
                                    <CommandGroup>
                                        {states.map((state) => (
                                            <CommandItem
                                                key={state}
                                                value={state}
                                                onSelect={() => handleStateToggle(state)}
                                            >
                                                <div className={cn(
                                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                    selectedStates.includes(state) 
                                                        ? "bg-primary text-primary-foreground" 
                                                        : "opacity-50"
                                                )}>
                                                    {selectedStates.includes(state) && <Check className="h-3 w-3" />}
                                                </div>
                                                {state}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                    {selectedStates.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {selectedStates.map((state) => (
                                <Badge key={state} variant="secondary" className="text-xs">
                                    {state}
                                    <button
                                        className="ml-1 hover:text-destructive"
                                        onClick={() => handleStateToggle(state)}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    )}
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
                                    checked={filters.never_login ?? false}
                                    onCheckedChange={(c) => handleChange('never_login', c)}
                                    id="never-login"
                                />
                                <Label htmlFor="never-login" className="font-normal cursor-pointer">
                                    Never Login (No Activations)
                                </Label>
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
