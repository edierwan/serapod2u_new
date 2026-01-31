'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Send, Loader2, RefreshCw, Archive, Play, Pause, Copy, MoreHorizontal, FileText } from 'lucide-react';
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Campaign = {
    id: string;
    name: string;
    objective: string;
    status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed' | 'archived';
    created_at: string;
    updated_at: string;
    scheduled_at: string | null;
    estimated_count: number;
    sent_count: number;
    failed_count: number;
    message_body: string;
};

export function CampaignsList({ onNew }: { onNew: () => void }) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

    const fetchCampaigns = async () => {
        try {
            const res = await fetch('/api/wa/marketing/campaigns');
            if (res.ok) {
                const data = await res.json();
                setCampaigns(data || []);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchCampaigns();
    }, []);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchCampaigns();
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'draft': return <Badge variant="secondary">Draft</Badge>;
            case 'scheduled': return <Badge variant="outline" className="border-blue-500 text-blue-500">Scheduled</Badge>;
            case 'sending': return <Badge className="bg-blue-600 animate-pulse">Sending</Badge>;
            case 'completed': return <Badge className="bg-green-600">Completed</Badge>;
            case 'paused': return <Badge variant="outline" className="border-orange-500 text-orange-500">Paused</Badge>;
            case 'failed': return <Badge variant="destructive">Failed</Badge>;
            default: return <Badge variant="outline">{status}</Badge>;
        }
    };

    const handleAction = async (action: string, id: string) => {
        // Implement action logic
        console.log(`Action ${action} on campaign ${id}`);
        // API calls would go here
        handleRefresh();
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="h-[200px] flex items-center justify-center">
                    <Loader2 className="animate-spin text-gray-400" />
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Recent Campaigns</CardTitle>
                        <CardDescription>Manage and track your marketing broadcasts.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing}>
                            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button onClick={onNew}>
                            <Send className="w-4 h-4 mr-2" /> Create Campaign
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {campaigns.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                            <div className="p-4 bg-gray-100 rounded-full">
                                <Send className="w-8 h-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium">Create your first campaign</h3>
                            <div className="text-sm text-gray-500 max-w-sm">
                                <ul className="space-y-2 text-left list-disc list-inside">
                                    <li>Select your audience target</li>
                                    <li>Design a WhatsApp template or message</li>
                                    <li>Schedule or send immediately</li>
                                </ul>
                            </div>
                            <Button onClick={onNew} className="mt-4">Get Started</Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Campaign Name</TableHead>
                                    <TableHead>Objective</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Recipients</TableHead>
                                    <TableHead>Scheduled / Time</TableHead>
                                    <TableHead>Updated</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {campaigns.map(c => (
                                    <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50/50" onClick={() => setSelectedCampaign(c)}>
                                        <TableCell className="font-medium">
                                            {c.name}
                                        </TableCell>
                                        <TableCell>{c.objective}</TableCell>
                                        <TableCell>{getStatusBadge(c.status)}</TableCell>
                                        <TableCell>{c.estimated_count.toLocaleString()}</TableCell>
                                        <TableCell>{c.scheduled_at ? format(new Date(c.scheduled_at), 'MMM d, HH:mm') : '-'}</TableCell>
                                        <TableCell className="text-muted-foreground text-xs">{format(new Date(c.updated_at), 'MMM d')}</TableCell>
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">Open menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleAction('duplicate', c.id)}>
                                                        <Copy className="mr-2 h-4 w-4" /> Duplicate
                                                    </DropdownMenuItem>
                                                    {c.status === 'sending' && (
                                                        <DropdownMenuItem onClick={() => handleAction('pause', c.id)}>
                                                            <Pause className="mr-2 h-4 w-4" /> Pause Sending
                                                        </DropdownMenuItem>
                                                    )}
                                                    {c.status === 'paused' && (
                                                        <DropdownMenuItem onClick={() => handleAction('resume', c.id)}>
                                                            <Play className="mr-2 h-4 w-4" /> Resume Sending
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onClick={() => handleAction('archive', c.id)} className="text-red-600">
                                                        <Archive className="mr-2 h-4 w-4" /> Archive
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Sheet open={!!selectedCampaign} onOpenChange={(open) => !open && setSelectedCampaign(null)}>
                <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                    {selectedCampaign && (
                        <>
                            <SheetHeader>
                                <SheetTitle>{selectedCampaign.name}</SheetTitle>
                                <SheetDescription>
                                    Campaign Details & Statistics
                                </SheetDescription>
                            </SheetHeader>
                            <div className="py-6 space-y-6">
                                <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <div className="text-sm font-medium text-gray-500">Status</div>
                                        <div className="mt-1">{getStatusBadge(selectedCampaign.status)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-medium text-gray-500">Objective</div>
                                        <div className="font-semibold">{selectedCampaign.objective}</div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">Message Preview</h4>
                                    <div className="p-4 bg-green-50 border border-green-100 rounded-lg text-sm whitespace-pre-wrap">
                                        {selectedCampaign.message_body}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">Target Audience</h4>
                                    <div className="p-4 border rounded-lg text-sm flex justify-between">
                                        <span>Estimated Recipients</span>
                                        <span className="font-bold">{selectedCampaign.estimated_count.toLocaleString()}</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">Delivery Stats</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="text-sm text-gray-500">Sent</div>
                                                <div className="text-2xl font-bold">{selectedCampaign.sent_count || 0}</div>
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="text-sm text-gray-500">Failed</div>
                                                <div className="text-2xl font-bold text-red-600">{selectedCampaign.failed_count || 0}</div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </div>
                            <SheetFooter>
                                <Button variant="outline" onClick={() => setSelectedCampaign(null)}>Close</Button>
                                {selectedCampaign.status === 'draft' && (
                                    <Button>Edit Campaign</Button>
                                )}
                            </SheetFooter>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}
