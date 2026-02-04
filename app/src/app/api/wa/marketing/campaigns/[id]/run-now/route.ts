import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: campaignId } = await params;
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

        // Get the campaign with admin client to bypass RLS
        const adminClient = createAdminClient();
        const { data: campaign, error: campaignError } = await adminClient
            .from('marketing_campaigns')
            .select('*')
            .eq('id', campaignId)
            .eq('organization_id', orgId)
            .single();

        if (campaignError || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }

        // Server-side validation: Only "scheduled" status campaigns can be run now
        if (campaign.status !== 'scheduled') {
            return NextResponse.json({ 
                error: `Campaign cannot be run now. Current status: ${campaign.status}. Only scheduled campaigns can be run immediately.` 
            }, { status: 400 });
        }

        // Additional validation: Campaign must have a scheduled_at time
        if (!campaign.scheduled_at) {
            return NextResponse.json({ 
                error: 'Campaign has no scheduled time. Cannot run now.' 
            }, { status: 400 });
        }

        // Clear scheduled_at and forward to the launch endpoint
        // This effectively makes it launch immediately
        await adminClient
            .from('marketing_campaigns')
            .update({ 
                scheduled_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', campaignId);

        // Call the launch endpoint to actually send the campaign
        const launchUrl = `${request.nextUrl.origin}/api/wa/marketing/campaigns/${campaignId}/launch`;
        const launchRes = await fetch(launchUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': request.headers.get('cookie') || ''
            }
        });

        if (!launchRes.ok) {
            const error = await launchRes.json();
            // Restore scheduled_at if launch failed
            await adminClient
                .from('marketing_campaigns')
                .update({ 
                    scheduled_at: campaign.scheduled_at,
                    status: 'scheduled'
                })
                .eq('id', campaignId);
            
            return NextResponse.json({ 
                error: error.error || 'Failed to launch campaign' 
            }, { status: launchRes.status });
        }

        const launchData = await launchRes.json();
        
        return NextResponse.json({
            success: true,
            message: 'Campaign started immediately',
            data: launchData
        });

    } catch (error) {
        console.error('[run-now] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
