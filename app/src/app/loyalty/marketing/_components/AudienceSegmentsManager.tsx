'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Edit, Trash2, Copy, Loader2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { AudienceFilters } from './AudienceFilterBuilder';

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
    const router = useRouter();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
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
        router.push('/loyalty/marketing/segments/create');
    };

    const handleEdit = (seg: Segment) => {
        router.push(`/loyalty/marketing/segments/${seg.id}`);
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
        </div>
    );
}
