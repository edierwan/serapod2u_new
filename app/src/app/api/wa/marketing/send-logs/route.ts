import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's org_id
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single();
        
        const orgId = userProfile?.organization_id;
        if (!orgId) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 });
        }

        // Get send logs with related data - use 'any' cast since table may not be in types yet
        const { data, error: logsError } = await (supabase as any)
            .from('marketing_send_logs')
            .select(`
                id,
                campaign_id,
                recipient_phone,
                recipient_name,
                organization_id,
                organization_name,
                organization_type,
                status,
                error_message,
                sent_at,
                delivered_at,
                read_at,
                created_at,
                sent_by
            `)
            .eq('company_id', orgId)
            .order('created_at', { ascending: false })
            .limit(1000);

        if (logsError) {
            console.error('Error fetching send logs:', logsError);
            // Return empty if table doesn't exist yet
            return NextResponse.json({ 
                logs: [], 
                stats: {
                    sent_today: 0,
                    failed_today: 0,
                    delivered_today: 0,
                    read_today: 0,
                    avg_delivery_time: 0,
                    active_campaigns: 0
                }
            });
        }

        const logs: any[] = data || [];

        // Get campaign names
        const campaignIds = Array.from(new Set(logs.map((l: any) => l.campaign_id).filter(Boolean)));
        let campaignMap: Record<string, string> = {};
        if (campaignIds.length > 0) {
            const { data: campaigns } = await (supabase as any)
                .from('marketing_campaigns')
                .select('id, name')
                .in('id', campaignIds);
            campaigns?.forEach((c: any) => {
                campaignMap[c.id] = c.name;
            });
        }

        // Get sent_by names
        const senderIds = Array.from(new Set(logs.map((l: any) => l.sent_by).filter(Boolean)));
        let senderMap: Record<string, string> = {};
        if (senderIds.length > 0) {
            const { data: senders } = await supabase
                .from('users')
                .select('id, full_name')
                .in('id', senderIds);
            senders?.forEach((s: any) => {
                senderMap[s.id] = s.full_name;
            });
        }

        // Transform logs to include campaign name and sender name
        const transformedLogs = logs.map((log: any) => ({
            ...log,
            campaign_name: campaignMap[log.campaign_id] || 'Unknown Campaign',
            sent_by_user: log.sent_by ? { full_name: senderMap[log.sent_by] || 'Unknown' } : null
        }));

        // Calculate today's stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayLogs = logs.filter((l: any) => new Date(l.created_at) >= today);
        
        const stats = {
            sent_today: todayLogs.length,
            failed_today: todayLogs.filter((l: any) => l.status === 'failed').length,
            delivered_today: todayLogs.filter((l: any) => l.status === 'delivered' || l.status === 'read').length,
            read_today: todayLogs.filter((l: any) => l.status === 'read').length,
            avg_delivery_time: calculateAvgDeliveryTime(todayLogs),
            active_campaigns: await getActiveCampaignsCount(supabase, orgId)
        };

        return NextResponse.json({ logs: transformedLogs, stats });

    } catch (error) {
        console.error('Error in send-logs API:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

function calculateAvgDeliveryTime(logs: any[]): number {
    const deliveredLogs = logs.filter((l: any) => l.delivered_at && l.sent_at);
    if (deliveredLogs.length === 0) return 0;
    
    const totalSeconds = deliveredLogs.reduce((acc: number, l: any) => {
        const sent = new Date(l.sent_at).getTime();
        const delivered = new Date(l.delivered_at).getTime();
        return acc + (delivered - sent) / 1000;
    }, 0);
    
    return Math.round(totalSeconds / deliveredLogs.length * 10) / 10;
}

async function getActiveCampaignsCount(supabase: any, orgId: string): Promise<number> {
    const { data } = await (supabase as any)
        .from('marketing_campaigns')
        .select('id')
        .eq('org_id', orgId)
        .eq('status', 'sending');
    
    return data?.length || 0;
}
