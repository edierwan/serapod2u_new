'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Save, ArrowLeft, Users } from 'lucide-react';
import { AudienceFilterBuilder, AudienceFilters } from '../AudienceFilterBuilder';
import { AudienceEstimator } from '../AudienceEstimator';
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SegmentData {
    id?: string;
    name: string;
    description: string;
    filters: AudienceFilters;
    estimated_count: number;
}

interface SegmentEditorProps {
    initialData?: SegmentData;
    isEditing?: boolean;
}

export function SegmentEditor({ initialData, isEditing = false }: SegmentEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);
    
    const [formData, setFormData] = useState<SegmentData>(initialData || {
        name: '',
        description: '',
        filters: { organization_type: 'all', state: 'any', opt_in_only: true },
        estimated_count: 0
    });

    const handleSave = async () => {
        if (!formData.name) {
             toast({ title: 'Error', description: 'Segment name is required', variant: 'destructive' });
             return;
        }

        setSaving(true);
        try {
            const url = isEditing && formData.id
                ? `/api/wa/marketing/segments/${formData.id}` 
                : '/api/wa/marketing/segments';
            const method = isEditing ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast({ title: 'Success', description: 'Segment saved successfully' });
                // Navigate back to the list
                router.push('/loyalty/marketing?tab=audience');
                router.refresh();
            } else {
                 const d = await res.json();
                 toast({ title: 'Error', description: d.error, variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to save segment', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        router.push('/loyalty/marketing?tab=audience');
    };

    return (
        <div className="container mx-auto max-w-7xl p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Button variant="ghost" size="sm" className="h-6 px-0 hover:bg-transparent" onClick={handleCancel}>
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Segments
                        </Button>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        {isEditing ? 'Edit Audience Segment' : 'Create Audience Segment'}
                    </h1>
                    <p className="text-gray-500">
                        Define filters to target a specific audience for your campaigns.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                        {isEditing ? 'Update Segment' : 'Save Segment'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Form & Filters */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Segment Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Segment Name</Label>
                                <Input 
                                    value={formData.name} 
                                    onChange={e => setFormData({...formData, name: e.target.value})}
                                    placeholder="e.g. VIP Customers KL" 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Input 
                                    value={formData.description} 
                                    onChange={e => setFormData({...formData, description: e.target.value})}
                                    placeholder="e.g. High value users in Kedah" 
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Audience Filters</CardTitle>
                            <CardDescription>Refine your audience based on their profile and behavior.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <AudienceFilterBuilder
                                filters={formData.filters}
                                onChange={f => setFormData({...formData, filters: f})}
                            />
                        </CardContent>
                    </Card>
                </div>
                    
                {/* Right Column: Preview */}
                <div className="lg:col-span-1">
                    <div className="lg:sticky lg:top-6 space-y-4">
                        <Card className="border-l-4 border-l-primary">
                            <CardContent className="pt-6">
                                <AudienceEstimator
                                    mode="filters"
                                    filters={formData.filters}
                                    onCountChange={count => setFormData(prev => ({ ...prev, estimated_count: count }))}
                                />
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
