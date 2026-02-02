'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Loader2, AlertTriangle, CheckCircle, XCircle, Ban } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface AudienceEstimatorProps {
    mode: 'filters' | 'segment' | 'specific_users';
    filters?: any;
    segmentId?: string;
    userIds?: string[];
    onCountChange?: (count: number) => void;
}

interface AudienceStats {
    total_all_users: number;      // Total users in the system
    total_matched: number;        // Users matching current filters
    eligible_count: number;       // Users with valid WhatsApp
    excluded_missing_phone: number;
    excluded_opt_out: number;
    excluded_invalid_wa: number;
    excluded_activity: number;
    excluded_total: number;
    preview: Array<{
        id: string;
        name: string;
        phone: string;
        state: string;
        organization_type: string;
        org_name: string;
    }>;
}

export function AudienceEstimator({ mode, filters, segmentId, userIds, onCountChange }: AudienceEstimatorProps) {
    const [stats, setStats] = useState<AudienceStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Use refs to avoid dependency issues with callbacks
    const onCountChangeRef = useRef(onCountChange);
    onCountChangeRef.current = onCountChange;
    
    // Serialize filters to detect actual changes (not just reference changes)
    const filtersKey = JSON.stringify(filters || {});
    const userIdsKey = userIds?.join(',') || '';

    useEffect(() => {
        let isMounted = true;
        const fetchStats = async () => {
            // Don't fetch if conditions aren't met
            if (mode === 'segment' && !segmentId) return;
            if (mode === 'specific_users' && (!userIds || userIds.length === 0)) {
                setStats(null);
                onCountChangeRef.current?.(0);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const res = await fetch('/api/wa/marketing/audience/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode,
                        filters,
                        segment_id: segmentId,
                        user_ids: userIds
                    })
                });

                if (!res.ok) throw new Error('Failed to resolve audience');

                const data = await res.json();
                if (isMounted) {
                    setStats(data);
                    onCountChangeRef.current?.(data.eligible_count);
                }
            } catch (err: any) {
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        const timer = setTimeout(fetchStats, 600);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, filtersKey, segmentId, userIdsKey]);

    if (error) {
        return (
            <div className="bg-red-50 p-4 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>Error estimating audience: {error}</span>
            </div>
        );
    }

    if (loading && !stats) {
        return (
            <div className="h-[300px] bg-gray-50 rounded-lg flex flex-col justify-center items-center text-center border border-dashed">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
                <p className="text-sm text-gray-500">Calculating audience size...</p>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="h-[300px] bg-gray-50 rounded-lg flex flex-col justify-center items-center text-center border border-dashed">
                <Users className="w-10 h-10 text-gray-300 mb-2" />
                <p className="text-gray-500">Configure filters to see audience estimate</p>
            </div>
        );
    }

    return (
        <div className="bg-white border rounded-lg shadow-sm overflow-hidden flex flex-col h-full max-h-[500px]">
            <div className="bg-gray-50 p-6 flex flex-col justify-center items-center text-center border-b">
                {loading && <Loader2 className="w-4 h-4 text-primary animate-spin absolute top-4 right-4" />}

                <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                    <Users className="w-8 h-8 text-primary" />
                </div>
                <h4 className="text-3xl font-bold text-gray-900">{stats.eligible_count.toLocaleString()}</h4>
                <p className="text-sm font-medium text-gray-700 mb-1">Eligible Recipients</p>
                <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Valid WhatsApp Number
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs w-full max-w-[240px]">
                    <div className="bg-white p-2 rounded border flex flex-col items-center">
                        <span className="text-gray-500">Total Matched</span>
                        <span className="font-bold">{stats.total_matched.toLocaleString()}</span>
                    </div>
                    <div className="bg-red-50 p-2 rounded border border-red-100 flex flex-col items-center text-red-700">
                        <span className="flex items-center gap-1"><Ban className="w-3 h-3" /> Excluded</span>
                        <span className="font-bold">{stats.excluded_total.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <ScrollArea className="flex-1 p-0">
                <div className="p-4">
                    <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Audience Preview</h5>
                    {stats.preview.length === 0 ? (
                        <p className="text-sm text-gray-400 italic text-center py-4">No eligible users found.</p>
                    ) : (
                        <div className="space-y-2">
                            {stats.preview.map((user) => (
                                <div key={user.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors">
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="text-sm font-medium truncate">{user.name}</span>
                                        <span className="text-xs text-gray-500 truncate">{user.org_name} ({user.organization_type})</span>
                                    </div>
                                    <div className="flex flex-col items-end shrink-0">
                                        <Badge variant="outline" className="font-mono text-[10px]">{user.phone}</Badge>
                                        <span className="text-[10px] text-gray-400 mt-1">{user.state || 'No Loction'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {stats.eligible_count > 20 && (
                        <p className="text-xs text-center text-gray-400 mt-4">And {stats.eligible_count - 20} others...</p>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
