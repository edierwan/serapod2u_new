'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Edit, Trash2, Copy, Save, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AudienceFilterBuilder, AudienceFilters } from './AudienceFilterBuilder';
import { AudienceEstimator } from './AudienceEstimator';
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

type Segment = {
    id: string;
    name: string;
    description: string;
    estimated_count: number;
    filters: AudienceFilters;
    updated_at: string;
};

export function AudienceSegmentsManager() {
    const { toast } = useToast();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Segment Editor State
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        filters: { organization_type: 'all', state: 'any', opt_in_only: true } as AudienceFilters,
        estimated_count: 0
    });
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchSegments = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/wa/marketing/segments');
            if (res.ok) {
                const data = await res.json();
                setSegments(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: 'Failed to load segments', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSegments();
    }, []);

    const handleNew = () => {
        setEditingSegment(null);
        setFormData({ name: '', description: '', filters: { organization_type: 'all', state: 'any', opt_in_only: true }, estimated_count: 0 });
        setIsSheetOpen(true);
    };

    const handleEdit = (seg: Segment) => {
        setEditingSegment(seg);
        setFormData({ 
            name: seg.name, 
            description: seg.description, 
            filters: seg.filters || { organization_type: 'all', state: 'any', opt_in_only: true },
            estimated_count: seg.estimated_count
        });
        setIsSheetOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name) {
             toast({ title: 'Error', description: 'Segment name is required', variant: 'destructive' });
             return;
        }

        setSaving(true);
        try {
            const url = editingSegment 
                ? `/api/wa/marketing/segments/${editingSegment.id}` 
                : '/api/wa/marketing/segments';
            const method = editingSegment ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast({ title: 'Success', description: 'Segment saved successfully' });
                setIsSheetOpen(false);
                fetchSegments();
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

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this segment?')) return;
        setDeletingId(id);
        try {
             const res = await fetch(`/api/wa/marketing/segments/${id}`, { method: 'DELETE' });
             if (res.ok) {
                 toast({ title: 'Deleted', description: 'Segment deleted' });
                 setSegments(prev => prev.filter(s => s.id !== id));
             } else {
                 toast({ title: 'Error', description: 'Failed to delete segment', variant: 'destructive' });
             }
        } catch(e) {
            toast({ title: 'Error', description: 'Failed to delete segment', variant: 'destructive' });
        } finally {
            setDeletingId(null);
        }
    };

    const handleDuplicate = async (seg: Segment) => {
        setSaving(true); 
        try {
             const res = await fetch('/api/wa/marketing/segments', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     name: `${seg.name} (Copy)`,
                     description: seg.description,
                     filters: seg.filters,
                     estimated_count: seg.estimated_count
                 })
             });
             if (res.ok) {
                 toast({ title: 'Success', description: 'Segment duplicated' });
                 fetchSegments();
             }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                 <div className="flex gap-4">
                     <Card className="w-64">
                         <CardContent className="pt-6">
                             <div className="text-2xl font-bold">{segments.length}</div>
                             <p className="text-xs text-secondary-foreground">Saved Segments</p>
                         </CardContent>
                     </Card>
                 </div>
                 <Button onClick={handleNew}><Plus className="w-4 h-4 mr-2" /> New Segment</Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Saved Segments</CardTitle>
                    <CardDescription>Target specific groups of users based on their behavior and profile.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Segment Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Est. Size</TableHead>
                                <TableHead>Last Updated</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading segments...</TableCell>
                                </TableRow>
                            ) : segments.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-12">
                                        <div className="flex flex-col items-center gap-2">
                                            <Users className="h-10 w-10 text-gray-300" />
                                            <p className="text-gray-900 font-medium">No segments yet</p>
                                            <p className="text-sm text-gray-500">Create a segment to target specific users.</p>
                                            <Button variant="outline" className="mt-2" onClick={handleNew}>Create Segment</Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                segments.map((segment) => (
                                    <TableRow key={segment.id}>
                                        <TableCell className="font-medium">{segment.name}</TableCell>
                                        <TableCell className="text-muted-foreground">{segment.description}</TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                                {segment.estimated_count.toLocaleString()} users
                                            </span>
                                        </TableCell>
                                        <TableCell>{new Date(segment.updated_at).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleEdit(segment)}><Edit className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDuplicate(segment)}><Copy className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(segment.id)} disabled={deletingId === segment.id}>
                                                    {deletingId === segment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-[92vw] sm:w-[520px] lg:w-[640px] 2xl:w-[720px] max-w-none flex flex-col h-full bg-slate-50 p-0 gap-0">
                    <SheetHeader className="px-6 py-4 bg-white border-b shrink-0">
                        <SheetTitle>{editingSegment ? 'Edit Segment' : 'Create New Segment'}</SheetTitle>
                        <SheetDescription>
                            Define the filters to target a specific audience.
                        </SheetDescription>
                    </SheetHeader>
                    
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Left Column: Form & Filters */}
                            <div className="lg:col-span-2 space-y-6">
                                <div className="space-y-4 bg-white p-4 rounded-lg border shadow-sm">
                                    <h3 className="font-medium text-sm text-gray-900 mb-2">Segment Details</h3>
                                    <div className="grid gap-4">
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
                                                placeholder="e.g. High value users in KL" 
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white p-4 rounded-lg border shadow-sm">
                                    <h3 className="font-medium text-sm text-gray-900 mb-4">Audience Filters</h3>
                                    <AudienceFilterBuilder
                                        filters={formData.filters}
                                        onChange={f => setFormData({...formData, filters: f})}
                                    />
                                </div>
                            </div>
                             
                            {/* Right Column: Preview */}
                            <div className="lg:col-span-1">
                                <div className="lg:sticky lg:top-0 space-y-4">
                                    <h3 className="font-medium text-sm text-gray-500 uppercase tracking-wider hidden lg:block">Preview</h3>
                                    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                                        <AudienceEstimator
                                            mode="filters"
                                            filters={formData.filters}
                                            onCountChange={count => setFormData(prev => ({ ...prev, estimated_count: count }))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                     <SheetFooter className="px-6 py-4 bg-white border-t shrink-0 flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsSheetOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                            Save Segment
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    );
}
