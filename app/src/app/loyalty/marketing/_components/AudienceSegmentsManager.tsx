'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Edit, Trash2, Copy, Loader2, Save, ArrowLeft, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    created_at?: string;
    creator?: {
        id: string;
        full_name: string;
    };
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

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

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

    // Memoized callback to prevent re-render loops in AudienceEstimator
    const handleCountChange = useCallback((count: number) => {
        setFormData(prev => ({ ...prev, estimated_count: count }));
    }, []);

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
        setFormData({ name: '', description: '', filters: { ...defaultFilters }, estimated_count: 0 });
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

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Left Column: Form & Filters - 3/5 = 60% */}
                    <div className="lg:col-span-3 space-y-6 order-2 lg:order-1">
                        <Card>
                            <CardHeader className="pb-4">
                                <CardTitle className="text-lg">Segment Details</CardTitle>
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
                            <CardHeader className="pb-4">
                                <CardTitle className="text-lg">Audience Filters</CardTitle>
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

                    {/* Right Column: Preview - 2/5 = 40% */}
                    <div className="lg:col-span-2 order-1 lg:order-2">
                        <div className="lg:sticky lg:top-6 space-y-4">
                            <Card className="border-l-4 border-l-primary">
                                <CardContent className="pt-6">
                                    <AudienceEstimator
                                        mode="filters"
                                        filters={formData.filters}
                                        onCountChange={handleCountChange}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Pagination calculations
    const totalPages = Math.ceil(segments.length / pageSize);
    const paginatedSegments = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return segments.slice(startIndex, startIndex + pageSize);
    }, [segments, currentPage, pageSize]);

    // Reset to page 1 when segments change
    useEffect(() => {
        setCurrentPage(1);
    }, [segments.length]);

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
                                <TableHead className="w-[50px]">#</TableHead>
                                <TableHead>Segment Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Est. Size</TableHead>
                                <TableHead>Created By</TableHead>
                                <TableHead>Last Updated</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading segments...</TableCell>
                                </TableRow>
                            ) : segments.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12">
                                        <div className="flex flex-col items-center gap-2">
                                            <Users className="h-10 w-10 text-gray-300" />
                                            <p className="text-gray-900 font-medium">No segments yet</p>
                                            <p className="text-sm text-gray-500">Create a segment to target specific users.</p>
                                            <Button variant="outline" className="mt-2" onClick={handleNew}>Create Segment</Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedSegments.map((segment, index) => (
                                    <TableRow key={segment.id}>
                                        <TableCell className="text-muted-foreground font-mono text-sm">
                                            {(currentPage - 1) * pageSize + index + 1}
                                        </TableCell>
                                        <TableCell className="font-medium">{segment.name}</TableCell>
                                        <TableCell className="text-muted-foreground max-w-[200px] truncate">{segment.description}</TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                                {segment.estimated_count.toLocaleString()} users
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {segment.creator?.full_name || '-'}
                                        </TableCell>
                                        <TableCell className="text-sm">{new Date(segment.updated_at).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownload(segment)} disabled={downloadingId === segment.id} title="Download">
                                                    {downloadingId === segment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(segment)} title="Edit"><Edit className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicate(segment)} title="Duplicate"><Copy className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(segment.id)} disabled={deletingId === segment.id} title="Delete">
                                                    {deletingId === segment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>

                    {/* Pagination Controls */}
                    {segments.length > 0 && (
                        <div className="flex items-center justify-between px-2 py-4 border-t">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>Rows per page:</span>
                                <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                                    <SelectTrigger className="w-[70px] h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="5">5</SelectItem>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                    </SelectContent>
                                </Select>
                                <span className="ml-4">
                                    Showing {Math.min((currentPage - 1) * pageSize + 1, segments.length)} - {Math.min(currentPage * pageSize, segments.length)} of {segments.length}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Previous
                                </Button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }
                                        return (
                                            <Button
                                                key={pageNum}
                                                variant={currentPage === pageNum ? "default" : "outline"}
                                                size="sm"
                                                className="w-8 h-8 p-0"
                                                onClick={() => setCurrentPage(pageNum)}
                                            >
                                                {pageNum}
                                            </Button>
                                        );
                                    })}
                                </div>
                                <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages || totalPages === 0}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
