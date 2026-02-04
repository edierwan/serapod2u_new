'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Send, Loader2, RefreshCw, Archive, Play, Pause, Copy, MoreHorizontal, FileText, ChevronLeft, ChevronRight, Trash2, Edit, Eye, Clock, Rocket, AlertTriangle } from 'lucide-react';
import { format, differenceInSeconds } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

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
    audience_filters?: any;
    template_id?: string;
    creator?: {
        id: string;
        full_name: string;
    };
};

interface CampaignsListProps {
    onNew: () => void;
    onEdit?: (campaign: Campaign) => void;
}

// Helper to format countdown as HH:MM:SS
function formatCountdown(scheduledAt: string): { display: string; isFuture: boolean; isOverdue: boolean } {
    const now = new Date();
    const scheduled = new Date(scheduledAt);
    const diffSeconds = differenceInSeconds(scheduled, now);
    
    if (diffSeconds <= 0) {
        return { display: '00:00:00', isFuture: false, isOverdue: true };
    }
    
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    return { 
        display: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
        isFuture: true,
        isOverdue: false
    };
}

export function CampaignsList({ onNew, onEdit }: CampaignsListProps) {
    const { toast } = useToast();
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [countdownTick, setCountdownTick] = useState(0);
    const [runNowConfirm, setRunNowConfirm] = useState<{ show: boolean; campaign: Campaign | null }>({ show: false, campaign: null });
    const [runningNow, setRunningNow] = useState(false);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Update countdown every second for scheduled campaigns
    useEffect(() => {
        const hasScheduled = campaigns.some(c => c.scheduled_at);
        if (!hasScheduled) return;
        
        const interval = setInterval(() => {
            setCountdownTick(t => t + 1);
            
            // Auto-refresh when a campaign's scheduled time just passed (within 5 seconds)
            const justPassed = campaigns.some(c => {
                if (!c.scheduled_at || c.status !== 'scheduled') return false;
                const diff = differenceInSeconds(new Date(c.scheduled_at), new Date());
                return diff <= 0 && diff > -5;
            });
            if (justPassed) {
                setTimeout(() => fetchCampaigns(), 5000);
            }
        }, 1000);
        
        return () => clearInterval(interval);
    }, [campaigns]);

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

    // Handle "Run Now" for scheduled campaigns - shows confirmation first
    const showRunNowConfirm = (campaign: Campaign) => {
        setRunNowConfirm({ show: true, campaign });
    };

    const handleRunNowConfirmed = async () => {
        const campaign = runNowConfirm.campaign;
        if (!campaign) return;
        
        setRunningNow(true);
        try {
            const res = await fetch(`/api/wa/marketing/campaigns/${campaign.id}/run-now`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (res.ok) {
                toast({
                    title: "Campaign Started! 🚀",
                    description: `${campaign.name} is now sending to ${campaign.estimated_count} recipients`
                });
                setRunNowConfirm({ show: false, campaign: null });
                handleRefresh();
            } else {
                const error = await res.json();
                toast({
                    title: "Failed to start campaign",
                    description: error.error || "Campaign is not eligible to run now",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to start campaign",
                variant: "destructive"
            });
        } finally {
            setRunningNow(false);
        }
    };

    // Pagination calculations
    const totalPages = Math.ceil(campaigns.length / pageSize);
    const paginatedCampaigns = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return campaigns.slice(startIndex, startIndex + pageSize);
    }, [campaigns, currentPage, pageSize]);

    // Reset to page 1 when campaigns change
    useEffect(() => {
        setCurrentPage(1);
    }, [campaigns.length]);

    const handleEditCampaign = (campaign: Campaign) => {
        if (onEdit) {
            onEdit(campaign);
        } else {
            // Fallback: open in sheet for editing
            setSelectedCampaign(campaign);
        }
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
                        <>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px]">#</TableHead>
                                        <TableHead>Campaign Name</TableHead>
                                        <TableHead>Objective</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Recipients</TableHead>
                                        <TableHead>Created By</TableHead>
                                        <TableHead>Scheduled / Time</TableHead>
                                        <TableHead>Updated</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedCampaigns.map((c, index) => {
                                        // Calculate countdown for scheduled campaigns
                                        const countdown = c.scheduled_at ? formatCountdown(c.scheduled_at) : null;
                                        const scheduledTime = c.scheduled_at ? format(new Date(c.scheduled_at), 'HH:mm:ss') : null;
                                        
                                        return (
                                        <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50/50" onClick={() => setSelectedCampaign(c)}>
                                            <TableCell className="text-muted-foreground font-mono text-sm">
                                                {(currentPage - 1) * pageSize + index + 1}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {c.name}
                                            </TableCell>
                                            <TableCell>{c.objective}</TableCell>
                                            <TableCell>{getStatusBadge(c.status)}</TableCell>
                                            <TableCell>{c.estimated_count.toLocaleString()}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {c.creator?.full_name || '-'}
                                            </TableCell>
                                            <TableCell>
                                                {c.scheduled_at ? (
                                                    <div className="space-y-1">
                                                        <div className="font-mono text-sm">
                                                            {format(new Date(c.scheduled_at), 'MMM d')} @ {scheduledTime}
                                                        </div>
                                                        {countdown?.isFuture ? (
                                                            <div className="flex items-center gap-1 text-xs text-blue-600">
                                                                <Clock className="h-3 w-3" />
                                                                <span className="font-mono">{countdown.display}</span>
                                                                <span className="text-muted-foreground">remaining</span>
                                                            </div>
                                                        ) : countdown?.isOverdue && !['completed', 'failed', 'sending', 'archived', 'paused'].includes(c.status) ? (
                                                            <div className="flex items-center gap-1 text-xs text-amber-600">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                <span className="font-mono">{countdown.display}</span>
                                                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-amber-400 text-amber-600">Overdue</Badge>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : '-'}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs">{format(new Date(c.updated_at), 'MMM d')}</TableCell>
                                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                <DropdownMenu open={openMenuId === c.id} onOpenChange={(open) => setOpenMenuId(open ? c.id : null)}>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-primary/20 rounded-md transition-colors">
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreHorizontal className="h-4 w-4 text-gray-700" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        sideOffset={5}
                                                        className="w-40 bg-white rounded-lg shadow-xl border border-gray-100 py-1.5 z-50"
                                                        style={{ zIndex: 9999 }}
                                                    >
                                                        {c.status === 'draft' && (
                                                            <DropdownMenuItem
                                                                onClick={() => { setOpenMenuId(null); handleEditCampaign(c); }}
                                                                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 rounded-md mx-1"
                                                            >
                                                                <Edit className="h-4 w-4 text-gray-600" />
                                                                Edit
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem
                                                            onClick={() => { setOpenMenuId(null); setSelectedCampaign(c); }}
                                                            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 rounded-md mx-1"
                                                        >
                                                            <Eye className="h-4 w-4 text-gray-600" />
                                                            View
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => { setOpenMenuId(null); handleAction('duplicate', c.id); }}
                                                            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 rounded-md mx-1"
                                                        >
                                                            <Copy className="h-4 w-4 text-gray-600" />
                                                            Duplicate
                                                        </DropdownMenuItem>
                                                        {/* Run Now for scheduled or draft campaigns */}
                                                        {(c.status === 'scheduled' || c.status === 'draft') && c.scheduled_at && (
                                                            <DropdownMenuItem
                                                                onClick={() => { setOpenMenuId(null); showRunNowConfirm(c); }}
                                                                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-green-700 hover:bg-green-50 cursor-pointer focus:bg-green-50 rounded-md mx-1"
                                                            >
                                                                <Rocket className="h-4 w-4 text-green-600" />
                                                                Run Now
                                                            </DropdownMenuItem>
                                                        )}
                                                        {c.status === 'sending' && (
                                                            <DropdownMenuItem
                                                                onClick={() => { setOpenMenuId(null); handleAction('pause', c.id); }}
                                                                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 rounded-md mx-1"
                                                            >
                                                                <Pause className="h-4 w-4 text-gray-600" />
                                                                Pause
                                                            </DropdownMenuItem>
                                                        )}
                                                        {c.status === 'paused' && (
                                                            <DropdownMenuItem
                                                                onClick={() => { setOpenMenuId(null); handleAction('resume', c.id); }}
                                                                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 rounded-md mx-1"
                                                            >
                                                                <Play className="h-4 w-4 text-gray-600" />
                                                                Resume
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator className="my-1.5 bg-gray-100" />
                                                        <DropdownMenuItem
                                                            onClick={() => { setOpenMenuId(null); handleAction('archive', c.id); }}
                                                            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50 cursor-pointer focus:bg-red-50 rounded-md mx-1"
                                                        >
                                                            <Archive className="h-4 w-4 text-red-600" />
                                                            Archive
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    );
                                    })}
                                </TableBody>
                            </Table>

                            {/* Pagination Controls */}
                            {campaigns.length > 0 && (
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
                                            Showing {Math.min((currentPage - 1) * pageSize + 1, campaigns.length)} - {Math.min(currentPage * pageSize, campaigns.length)} of {campaigns.length}
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
                        </>
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
                                    <Button onClick={() => {
                                        handleEditCampaign(selectedCampaign);
                                        setSelectedCampaign(null);
                                    }}>Edit Campaign</Button>
                                )}
                            </SheetFooter>
                        </>
                    )}
                </SheetContent>
            </Sheet>

            {/* Run Now Confirmation Modal */}
            <AlertDialog open={runNowConfirm.show} onOpenChange={(open) => !open && setRunNowConfirm({ show: false, campaign: null })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Rocket className="h-5 w-5 text-green-600" />
                            Run Campaign Now?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3">
                                <p>
                                    You are about to start sending <strong>{runNowConfirm.campaign?.name}</strong> immediately.
                                </p>
                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <div className="font-medium">This action cannot be undone</div>
                                            <div className="text-amber-700 mt-1">
                                                Messages will be sent to <strong>{runNowConfirm.campaign?.estimated_count?.toLocaleString()}</strong> recipients.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={runningNow}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRunNowConfirmed}
                            disabled={runningNow}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            {runningNow ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Starting...
                                </>
                            ) : (
                                <>
                                    <Rocket className="h-4 w-4 mr-2" />
                                    Run Now
                                </>
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
