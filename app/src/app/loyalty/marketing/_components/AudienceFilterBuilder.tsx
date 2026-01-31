'use client';

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from 'lucide-react';

export interface AudienceFilters {
    organization_type: string;
    state: string;
    opt_in_only: boolean;
}

interface AudienceFilterBuilderProps {
    filters: AudienceFilters;
    onChange: (filters: AudienceFilters) => void;
}

export function AudienceFilterBuilder({ filters, onChange }: AudienceFilterBuilderProps) {
    const [orgTypes, setOrgTypes] = useState<string[]>([]);
    const [states, setStates] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch('/api/wa/marketing/audience/org-types').then(r => r.json()),
            fetch('/api/wa/marketing/audience/states').then(r => r.json())
        ]).then(([orgData, stateData]) => {
            setOrgTypes(orgData.organization_types || []);
            setStates(stateData.states || []);
            setLoading(false);
        }).catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, []);

    const handleChange = (key: keyof AudienceFilters, value: any) => {
        onChange({ ...filters, [key]: value });
    };

    if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading options...</div>;

    return (
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

            <div className="flex items-center space-x-2 py-4">
                <Switch 
                    checked={filters.opt_in_only} 
                    onCheckedChange={(c) => handleChange('opt_in_only', c)} 
                    id="opt-in" 
                />
                <Label htmlFor="opt-in" className="font-normal cursor-pointer">
                    Only send to opted-in users (Strongly Recommended)
                </Label>
            </div>
        </div>
    );
}
