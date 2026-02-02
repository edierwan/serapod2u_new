'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
    Search, RotateCcw, Trash2, Send, CheckCircle2, XCircle, Clock, Eye, 
    ChevronLeft, ChevronRight, Loader2, AlertTriangle, User, Building2, Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";

interface SendLog {
    id: string;
    campaign_id: string;
    campaign_name: string;
    recipient_phone: string;
    recipient_name: string | null;
    organization_name: string | null;
    organization_type: string | null;
    status: 'queued' | 'sending' | 'delivered' | 'read' | 'failed';
    error_message: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    created_at: string;
    sent_by_user?: {
        full_name: string;
    };
}

interface Stats {
    sent_today: number;
    failed_today: number;
    delivered_today: number;
    read_today: number;
    avg_delivery_time: number;
    active_campaigns: number;
}

export function SendLogsView() {
    const { toast } = useToast();
    const [logs, setLogs] = useState<SendLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; logId: string | null }>({ show: false, logId: null });
    const [deleting, setDeleting] = useState(false);
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    // Stats
    const [stats, setStats] = useState<Stats>({
        sent_today: 0,
        failed_today: 0,
        delivered_today: 0,
        read_today: 0,
        avg_delivery_time: 0,
        active_campaigns: 0
    });

    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/wa/marketing/send-logs');
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs || []);
                setStats(data.stats || stats);
            }
        } catch (err) {
            console.error('Error fetching send logs:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchLogs, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchLogs();
    };

    const handleDeleteLog = async (logId: string) => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/wa/marketing/send-logs/${logId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setLogs(logs.filter(l => l.id !== logId));
                toast({ title: 'Success', description: 'Log entry deleted successfully' });
            } else {
                toast({ title: 'Error', description: 'Failed to delete log entry', variant: 'destructive' });
            }
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to delete log entry', variant: 'destructive' });
        } finally {
            setDeleting(false);
            setDeleteConfirm({ show: false, logId: null });
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'queued':
                return <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-300"><Clock className="w-3 h-3 mr-1" /> Queued</Badge>;
            case 'sending':
                return <Badge className="bg-blue-100 text-blue-700 border-blue-300"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Sending</Badge>;
            case 'delivered':
                return <Badge className="bg-green-100 text-green-700 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" /> Delivered</Badge>;
            case 'read':
                return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300"><Eye className="w-3 h-3 mr-1" /> Read</Badge>;
            case 'failed':
                return <Badge variant="destructive" className="bg-red-100 text-red-700 border-red-300"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    // Filter and search
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const matchesSearch = !searchTerm || 
                log.recipient_phone.includes(searchTerm) ||
                log.campaign_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (log.recipient_name && log.recipient_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (log.organization_name && log.organization_name.toLowerCase().includes(searchTerm.toLowerCase()));
            
            const matchesStatus = statusFilter === 'all' || log.status === statusFilter;
            
            return matchesSearch && matchesStatus;
        });
    }, [logs, searchTerm, statusFilter]);

    // Pagination
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    const paginatedLogs = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredLogs.slice(startIndex, startIndex + pageSize);
    }, [filteredLogs, currentPage, pageSize]);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-blue-700 flex items-center gap-2">
                            <Send className="w-4 h-4" /> Sent Today
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-blue-900">{stats.sent_today.toLocaleString()}</div>
                    </CardContent>
                </Card>
                
                <Card className="bg-gradient-to-br from-green-50 to-white border-green-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-green-700 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4" /> Delivered
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-green-900">{stats.delivered_today.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-700 flex items-center gap-2">
                            <Eye className="w-4 h-4" /> Read
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-emerald-900">{stats.read_today.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-50 to-white border-red-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                            <XCircle className="w-4 h-4" /> Failed
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-red-900">{stats.failed_today.toLocaleString()}</div>
                        <p className="text-xs text-red-600">
                            {stats.sent_today > 0 ? ((stats.failed_today / stats.sent_today) * 100).toFixed(1) : 0}% failure rate
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-purple-700 flex items-center gap-2">
                            <Clock className="w-4 h-4" /> Avg Delivery
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-purple-900">{stats.avg_delivery_time}s</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-2">
                            <Send className="w-4 h-4" /> Active
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-amber-900">{stats.active_campaigns}</div>
                        <p className="text-xs text-amber-600">campaigns sending</p>
                    </CardContent>
                </Card>
            </div>

            {/* Logs Table */}
            <Card>
                <CardHeader className="border-b">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <CardTitle className="text-lg">Delivery Logs</CardTitle>
                            <CardDescription>Real-time status of message delivery</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input 
                                    placeholder="Search recipient, campaign, org..." 
                                    className="pl-9 w-64"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-32">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="queued">Queued</SelectItem>
                                    <SelectItem value="sending">Sending</SelectItem>
                                    <SelectItem value="delivered">Delivered</SelectItem>
                                    <SelectItem value="read">Read</SelectItem>
                                    <SelectItem value="failed">Failed</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button 
                                variant="outline" 
                                size="icon" 
                                onClick={handleRefresh}
                                disabled={refreshing}
                            >
                                <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {filteredLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <Send className="w-12 h-12 text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900">No delivery logs yet</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                Logs will appear here when you launch campaigns
                            </p>
                        </div>
                    ) : (
                        <>
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50">
                                        <TableHead className="w-12 text-xs font-semibold">#</TableHead>
                                        <TableHead className="text-xs font-semibold">Date & Time</TableHead>
                                        <TableHead className="text-xs font-semibold">Campaign</TableHead>
                                        <TableHead className="text-xs font-semibold">Recipient</TableHead>
                                        <TableHead className="text-xs font-semibold">Organization</TableHead>
                                        <TableHead className="text-xs font-semibold">Sent By</TableHead>
                                        <TableHead className="text-xs font-semibold">Status</TableHead>
                                        <TableHead className="text-xs font-semibold">Error</TableHead>
                                        <TableHead className="text-xs font-semibold text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLogs.map((log, index) => (
                                        <TableRow key={log.id} className="hover:bg-gray-50">
                                            <TableCell className="text-xs text-gray-500 font-mono">
                                                {(currentPage - 1) * pageSize + index + 1}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2 text-xs">
                                                    <Calendar className="w-3 h-3 text-gray-400" />
                                                    <div>
                                                        <div className="font-medium">{format(new Date(log.created_at), 'dd MMM yyyy')}</div>
                                                        <div className="text-gray-500">{format(new Date(log.created_at), 'HH:mm:ss')}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm font-medium">{log.campaign_name}</span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <User className="w-3 h-3 text-gray-400" />
                                                    <div>
                                                        <div className="text-sm font-medium">{log.recipient_name || 'Unknown'}</div>
                                                        <div className="text-xs text-gray-500 font-mono">{log.recipient_phone}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {log.organization_name ? (
                                                    <div className="flex items-center gap-2">
                                                        <Building2 className="w-3 h-3 text-gray-400" />
                                                        <div>
                                                            <div className="text-xs font-medium">{log.organization_name}</div>
                                                            {log.organization_type && (
                                                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                                                    {log.organization_type}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-gray-400">End User</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-gray-600">
                                                    {log.sent_by_user?.full_name || 'System'}
                                                </span>
                                            </TableCell>
                                            <TableCell>{getStatusBadge(log.status)}</TableCell>
                                            <TableCell>
                                                {log.error_message && (
                                                    <div className="flex items-center gap-1 text-xs text-red-600">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        <span>{log.error_message}</span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                    onClick={() => setDeleteConfirm({ show: true, logId: log.id })}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {/* Pagination */}
                            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <span>Rows per page:</span>
                                    <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                                        <SelectTrigger className="w-16 h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="20">20</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <span className="ml-4">
                                        Showing {Math.min((currentPage - 1) * pageSize + 1, filteredLogs.length)} - {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length}
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
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteConfirm.show} onOpenChange={(open) => !open && setDeleteConfirm({ show: false, logId: null })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Log Entry</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this delivery log entry? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteConfirm.logId && handleDeleteLog(deleteConfirm.logId)}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
