'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Edit, Trash2, Copy, Loader2, Save, ArrowLeft, Download } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { AudienceFilterBuilder, AudienceFilters } from './AudienceFilterBuilder';
import { AudienceEstimator } from './AudienceEstimator';

type Segment = {
    id: string;
    name: string;
    description: string;
    estimated_count: number;
    filters: AudienceFilters;
    updated_at: string;
};

type ViewMode = 'list' | 'create' | 'edit';

const defaultFilters: AudienceFilters = {
    organization_type: 'all',
    state: 'any',
    opt_in_only: true,
    only_valid_whatsapp: true
};

export function AudienceSegmentsManager() {
    const { toast } = useToast();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // View mode state
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [editingSegment, setEditingSegment] = useState<Segment | null>(null);

    // Form data
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        filters: defaultFilters,
        estimated_count: 0
    });

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

    const handleDownload = async (segment: Segment) => {
        setDownloadingId(segment.id);
        try {
            const res = await fetch('/api/wa/marketing/audience/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'segment',
                    segment_id: segment.id,
                    include_all: true
                })
            });

            if (!res.ok) throw new Error("Failed to fetch segment data");

            const data = await res.json();
            const users = data.users || [];

            if (users.length === 0) {
                toast({ title: "Info", description: "No users in this segment to download." });
                return;
            }

            // Convert to CSV
            const headers = ["User ID", "Name", "Phone", "State", "Org Type", "Org Name", "Balance", "Collected System", "Tx Count"];
            const csvRows = [headers.join(",")];

            users.forEach((u: any) => {
                const row = [
                    u.id,
                    `"${(u.name || '').replace(/"/g, '""')}"`,
                    u.phone,
                    u.state || '',
                    u.organization_type,
                    `"${(u.org_name || '').replace(/"/g, '""')}"`,
                    u.current_balance,
                    u.collected_system,
                    u.transactions_count
                ];
                csvRows.push(row.join(","));
            });

            const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `${segment.name.replace(/\s+/g, '_')}_users.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({ title: "Success", description: "Segment data downloaded." });
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to download segment data", variant: "destructive" });
        } finally {
            setDownloadingId(null);
        }
    };

    useEffect(() => {
        fetchSegments();
    }, []);

    const handleNew = () => {
        setEditingSegment(null);
        setFormData({ name: '', description: '', filters: defaultFilters, estimated_count: 0 });
        setViewMode('create');
    };

    const handleEdit = (seg: Segment) => {
        setEditingSegment(seg);
        setFormData({
            name: seg.name,
            description: seg.description,
            filters: seg.filters || defaultFilters,
            estimated_count: seg.estimated_count
        });
        setViewMode('edit');
    };

    const handleCancel = () => {
        setViewMode('list');
        setEditingSegment(null);
        setFormData({ name: '', description: '', filters: defaultFilters, estimated_count: 0 });
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
                setViewMode('list');
                setEditingSegment(null);
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
        } catch (e) {
            toast({ title: 'Error', description: 'Failed to delete segment', variant: 'destructive' });
        } finally {
            setDeletingId(null);
        }
    };

    const handleDuplicate = async (seg: Segment) => {
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
        } catch (e) {
            toast({ title: 'Error', description: 'Failed to duplicate segment', variant: 'destructive' });
        }
    };

    // Render Editor View
    if (viewMode === 'create' || viewMode === 'edit') {
        return (
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <Button variant="ghost" size="sm" className="h-6 px-0 hover:bg-transparent" onClick={handleCancel}>
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Segments
                            </Button>
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                            {viewMode === 'edit' ? 'Edit Audience Segment' : 'Create Audience Segment'}
                        </h2>
                        <p className="text-gray-500">
                            Define filters to target a specific audience for your campaigns.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                            {viewMode === 'edit' ? 'Update Segment' : 'Save Segment'}
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
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g. VIP Customers KL"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Description</Label>
                                    <Input
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
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
                                    onChange={(f: AudienceFilters) => setFormData({ ...formData, filters: f })}
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
                                        onCountChange={(count: number) => setFormData(prev => ({ ...prev, estimated_count: count }))}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Render List View
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
                                                <Button variant="ghost" size="icon" onClick={() => handleDownload(segment)} disabled={downloadingId === segment.id}>
                                                    {downloadingId === segment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                                </Button>
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
        </div>
    );
}
