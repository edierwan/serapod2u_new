'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Loader2, AlertTriangle, CheckCircle, XCircle, Ban, Search, UserMinus, UserPlus, RefreshCw } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AudienceEstimatorProps {
    mode: 'filters' | 'segment' | 'specific_users';
    filters?: any;
    segmentId?: string;
    userIds?: string[];
    onCountChange?: (count: number) => void;
    overrides?: {
        include_ids: string[];
        exclude_ids: string[];
    };
    onOverrideChange?: (action: 'include' | 'exclude', userId: string) => void;
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
    excluded_by_override: number; // New field
    preview: Array<{
        id: string;
        name: string;
        phone: string;
        state: string;
        organization_type: string;
        org_name: string;
        status: 'eligible' | 'excluded';
        exclusion_reason?: string;
    }>;
    excluded_list?: Array<{ // New field
        id: string;
        name: string;
        phone: string;
        state: string;
        organization_type: string;
        org_name: string;
        status: 'excluded';
        exclusion_reason?: string;
    }>;
}

export function AudienceEstimator({ mode, filters, segmentId, userIds, onCountChange, overrides, onOverrideChange }: AudienceEstimatorProps) {
    const [stats, setStats] = useState<AudienceStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'eligible' | 'excluded'>('eligible');
    const [searchQuery, setSearchQuery] = useState('');

    // Pending actions - these are optimistic and haven't been reflected in API stats yet
    const [pendingExcludes, setPendingExcludes] = useState<Set<string>>(new Set());
    const [pendingIncludes, setPendingIncludes] = useState<Set<string>>(new Set());
    
    // Store the actual user data for manually excluded users (so they persist when switching tabs)
    const [manuallyExcludedUsersData, setManuallyExcludedUsersData] = useState<Map<string, AudienceStats['preview'][0]>>(new Map());

    // List navigation state
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const PAGE_SIZE = 50;

    // Use refs to avoid dependency issues with callbacks
    const onCountChangeRef = useRef(onCountChange);
    onCountChangeRef.current = onCountChange;

    // Serialize filters to detect actual changes (not just reference changes)
    const filtersKey = JSON.stringify(filters || {});
    const userIdsKey = userIds?.join(',') || '';
    const overridesKey = JSON.stringify(overrides || {});

    // Clear pending actions when API data is refreshed (stats change means API returned new data)
    const statsKey = stats ? `${stats.eligible_count}-${stats.excluded_total}` : '';
    useEffect(() => {
        // Reset pending actions when new stats arrive from API
        setPendingExcludes(new Set());
        setPendingIncludes(new Set());
        setManuallyExcludedUsersData(new Map());
    }, [statsKey]);

    // Reset pagination when filters change
    useEffect(() => {
        setPage(0);
        setHasMore(true);
    }, [mode, filtersKey, segmentId, userIdsKey, overridesKey, activeTab]);

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

            // Only show full loading on initial load or filter change
            if (page === 0) setLoading(true);
            setError(null);

            try {
                const res = await fetch('/api/wa/marketing/audience/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode,
                        filters,
                        segment_id: segmentId,
                        user_ids: userIds,
                        overrides, // Pass overrides to API
                        offset: page * PAGE_SIZE,
                        limit: PAGE_SIZE,
                        view: activeTab
                    })
                });

                if (!res.ok) throw new Error('Failed to resolve audience');

                const data = await res.json();
                if (isMounted) {
                    if (page === 0) {
                        setStats(data);
                    } else {
                        setStats(prev => {
                            if (!prev) return data;
                            return {
                                ...data, // Update counts
                                preview: activeTab === 'eligible' ? [...prev.preview, ...data.preview] : prev.preview,
                                excluded_list: activeTab === 'excluded'
                                    ? [...(prev.excluded_list || []), ...(data.excluded_list || [])]
                                    : prev.excluded_list
                            };
                        });
                    }

                    // Check if we reached the end
                    const currentListSize = activeTab === 'eligible' ? data.preview.length : data.excluded_list?.length || 0;
                    if (currentListSize < PAGE_SIZE) {
                        setHasMore(false);
                    }

                    onCountChangeRef.current?.(data.eligible_count);
                }
            } catch (err: any) {
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        const timer = setTimeout(fetchStats, page === 0 ? 600 : 0);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, filtersKey, segmentId, userIdsKey, overridesKey, activeTab, page]);

    // Calculate optimistic count adjustments based on pending actions
    // Pending excludes reduce eligible count
    const pendingExcludeCount = pendingExcludes.size;
    // Pending includes increase eligible count
    const pendingIncludeCount = pendingIncludes.size;

    // Adjusted counts for display
    const adjustedEligibleCount = stats 
        ? stats.eligible_count - pendingExcludeCount + pendingIncludeCount 
        : 0;

    // Report adjusted count to parent whenever it changes
    useEffect(() => {
        if (stats) {
            onCountChangeRef.current?.(adjustedEligibleCount);
        }
    }, [adjustedEligibleCount, stats]);

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
            <div className="h-[500px] bg-gray-50 rounded-lg flex flex-col justify-center items-center text-center border border-dashed">
                <Users className="w-10 h-10 text-gray-300 mb-2" />
                <p className="text-gray-500">Configure filters to see audience estimate</p>
            </div>
        );
    }

    // Now define variables that depend on stats existing
    const adjustedExcludedTotal = stats.excluded_total + pendingExcludeCount - pendingIncludeCount;

    // Get users that were manually excluded from eligible (from stored data)
    const manuallyExcludedUsers = Array.from(manuallyExcludedUsersData.values())
        .map(u => ({
            ...u,
            status: 'excluded' as const,
            exclusion_reason: 'Manually Excluded'
        }));

    // Build the list based on active tab
    let filteredPreview: typeof stats.preview = [];
    
    if (activeTab === 'eligible') {
        // Eligible tab: show preview minus pending excludes
        filteredPreview = stats.preview
            .filter(u => !pendingExcludes.has(u.id))
            .filter(u =>
                !searchQuery ||
                u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                u.phone?.includes(searchQuery) ||
                (u.org_name && u.org_name.toLowerCase().includes(searchQuery.toLowerCase()))
            );
    } else {
        // Excluded tab: show excluded_list minus pending includes, plus manually excluded from eligible
        const baseExcludedList = (stats.excluded_list || [])
            .filter(u => !pendingIncludes.has(u.id));
        
        // Combine with manually excluded users (at the top)
        const combinedExcluded = [...manuallyExcludedUsers, ...baseExcludedList];
        
        filteredPreview = combinedExcluded
            .filter(u =>
                !searchQuery ||
                u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                u.phone?.includes(searchQuery) ||
                (u.org_name && u.org_name.toLowerCase().includes(searchQuery.toLowerCase()))
            );
    }

    // Handle exclude/include with optimistic update
    const handleOverrideAction = (action: 'include' | 'exclude', userId: string, userData?: AudienceStats['preview'][0]) => {
        if (action === 'exclude') {
            // Store the user data so we can show it in excluded tab
            if (userData) {
                setManuallyExcludedUsersData(prev => {
                    const next = new Map(prev);
                    next.set(userId, userData);
                    return next;
                });
            }
            // Add to pending excludes
            setPendingExcludes(prev => new Set([...prev, userId]));
            setPendingIncludes(prev => {
                const next = new Set(prev);
                next.delete(userId);
                return next;
            });
        } else {
            // Remove from manually excluded users data
            setManuallyExcludedUsersData(prev => {
                const next = new Map(prev);
                next.delete(userId);
                return next;
            });
            // Add to pending includes
            setPendingIncludes(prev => new Set([...prev, userId]));
            setPendingExcludes(prev => {
                const next = new Set(prev);
                next.delete(userId);
                return next;
            });
        }
        // Call parent handler
        onOverrideChange?.(action, userId);
    };

    // Helper to check if user can be included back (must have valid phone)
    const canIncludeUser = (user: { phone?: string; exclusion_reason?: string }) => {
        // Cannot include if no phone number
        if (!user.phone || user.phone.trim() === '') return false;
        // Cannot include if system exclusion reasons (missing phone, invalid whatsapp, opt-out)
        const systemExclusions = ['Missing Phone', 'Invalid WhatsApp', 'Missing/Invalid Phone', 'Opt-out', 'No Phone'];
        if (systemExclusions.some(r => user.exclusion_reason?.includes(r))) return false;
        return true;
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm overflow-hidden flex flex-col h-full max-h-[700px]">
            <div className="bg-gray-50 p-6 flex flex-col justify-center items-center text-center border-b shrink-0">
                {loading && <Loader2 className="w-4 h-4 text-primary animate-spin absolute top-4 right-4" />}

                <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                    <Users className="w-8 h-8 text-primary" />
                </div>
                <h4 className="text-3xl font-bold text-gray-900">{adjustedEligibleCount.toLocaleString()}</h4>
                <p className="text-sm font-medium text-gray-700 mb-1">Eligible Recipients</p>
                <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Valid WhatsApp Number
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs w-full max-w-[240px]">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="bg-white p-2 rounded border flex flex-col items-center cursor-help">
                                    <span className="text-gray-500">Total Matched</span>
                                    <span className="font-bold">{stats.total_matched.toLocaleString()}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>Based on filters only</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="bg-red-50 p-2 rounded border border-red-100 flex flex-col items-center text-red-700 cursor-help">
                                    <span className="flex items-center gap-1"><Ban className="w-3 h-3" /> Excluded</span>
                                    <span className="font-bold">{adjustedExcludedTotal.toLocaleString()}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <div className="text-xs space-y-1">
                                    <p>System excluded: {stats.excluded_total - (stats.excluded_by_override || 0)}</p>
                                    <p>Manually excluded: {(stats.excluded_by_override || 0) + pendingExcludeCount}</p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex-1 flex flex-col min-h-0">
                <div className="px-4 pt-4 border-b flex flex-col gap-4 bg-white shrink-0">
                    <TabsList className="w-full">
                        <TabsTrigger value="eligible" className="flex-1">
                            Eligible ({adjustedEligibleCount})
                        </TabsTrigger>
                        <TabsTrigger value="excluded" className="flex-1">
                            Excluded ({adjustedExcludedTotal})
                        </TabsTrigger>
                    </TabsList>

                    <div className="relative pb-4">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search by name, phone or company..."
                            className="pl-8"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-hidden relative bg-white">
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-2 pb-16">
                            {filteredPreview.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                                    <Search className="w-8 h-8 opacity-20" />
                                    <p className="text-sm">No users found.</p>
                                </div>
                            ) : (
                                <>
                                    {filteredPreview.map((user, index) => (
                                        <div key={user.id} className="group flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 hover:border-gray-200 transition-all">
                                            <div className="flex items-start gap-3 overflow-hidden mr-3">
                                                <span className="text-sm font-medium text-gray-400 shrink-0 w-6">{index + 1}.</span>
                                                <div className="flex flex-col overflow-hidden">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium truncate">{user.name}</span>
                                                        {user.status === 'excluded' && (
                                                            <Badge variant="destructive" className="text-[10px] h-4 px-1">{user.exclusion_reason || 'Excluded'}</Badge>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-gray-500 truncate">{user.org_name} ({user.organization_type})</span>
                                                    <div className="flex items-center gap-2 mt-1 md:hidden">
                                                        <Badge variant="secondary" className="font-mono text-[10px] px-1 h-5">{user.phone}</Badge>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="hidden md:flex flex-col items-end">
                                                    <Badge variant="outline" className="font-mono text-[10px]">{user.phone}</Badge>
                                                    <span className="text-[10px] text-gray-400 mt-1">{user.state || 'No Location'}</span>
                                                </div>

                                                {onOverrideChange && (
                                                    activeTab === 'eligible' ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => handleOverrideAction('exclude', user.id, user)}
                                                            title="Exclude User"
                                                        >
                                                            <UserMinus className="h-4 w-4" />
                                                        </Button>
                                                    ) : (
                                                        // Only allow re-inclusion if user has valid phone number
                                                        canIncludeUser(user) && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-green-600 hover:bg-green-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                onClick={() => handleOverrideAction('include', user.id, user)}
                                                                title="Include User"
                                                            >
                                                                <UserPlus className="h-4 w-4" />
                                                            </Button>
                                                        )
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {hasMore && !searchQuery && (
                                        <div className="pt-2 flex justify-center sticky bottom-0 bg-white/90 p-2 backdrop-blur-sm">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setPage(p => p + 1)}
                                                disabled={loading}
                                                className="w-full"
                                            >
                                                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                                                Load More Users
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </Tabs>
        </div>
    );
}
