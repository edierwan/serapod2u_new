'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, RefreshCw } from 'lucide-react';
import { format } from "date-fns";

type Campaign = {
    id: string;
    name: string;
    objective: string;
    status: string;
    created_at: string;
    scheduled_at: string | null;
    estimated_count: number;
    // We would need real stats from a separate table or query, but for now assuming fields exist
    sent_count?: number; 
    delivered_count?: number;
};

export function CampaignsList({ onNew }: { onNew: () => void }) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchCampaigns = async () => {
        try {
            const res = await fetch('/api/marketing/campaigns');
            if (res.ok) {
                const data = await res.json();
                setCampaigns(data.campaigns || []);
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
                <div className="rounded-md border">
                    <div className="grid grid-cols-6 gap-4 p-4 font-medium bg-gray-50 text-sm border-b">
                        <div className="col-span-2">Campaign Name</div>
                        <div>Objective</div>
                        <div>Status</div>
                        <div>Recipients</div>
                        <div className="text-right">Scheduled / Sent</div>
                    </div>
                    
                    {campaigns.length === 0 && (
                         <div className="p-8 text-center text-gray-500 text-sm">
                            No campaigns found. Create your first one!
                        </div>
                    )}

                    {campaigns.map(c => (
                        <div key={c.id} className="grid grid-cols-6 gap-4 p-4 text-sm items-center border-b last:border-0 hover:bg-gray-50/50">
                            <div className="col-span-2 font-medium">
                                {c.name}
                                <div className="text-xs text-gray-400 font-normal">{format(new Date(c.created_at), 'MMM d, yyyy')}</div>
                            </div>
                            <div><Badge variant="outline">{c.objective}</Badge></div>
                            <div>
                                <Badge className={
                                    c.status === 'completed' ? 'bg-green-600' : 
                                    c.status === 'scheduled' ? 'bg-blue-600' :
                                    c.status === 'draft' ? 'bg-gray-400' : 'bg-yellow-500'
                                }>
                                    {c.status}
                                </Badge>
                            </div>
                            <div className="text-gray-700">
                                {c.estimated_count} est.
                            </div>
                            <div className="text-right text-xs text-gray-500">
                                {c.scheduled_at ? format(new Date(c.scheduled_at), 'PP p') : '-'}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
