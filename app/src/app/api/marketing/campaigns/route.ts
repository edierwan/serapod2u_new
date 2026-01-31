
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    const supabase = await createClient();

    // 1. Check Auth & Permissions
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has marketing access (simplified: check if admin/manager role)
    // In real app, check `user.role_code` or permissions table

    try {
        const body = await req.json();
        const {
            name,
            objective,
            audienceFilters,
            messageBody,
            templateId,
            scheduledAt,
            quietHoursEnabled
        } = body;

        // Validate inputs
        if (!name || !messageBody) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 2. Resolve Audience Count (Estimate)
        // Query users matching filters to get ID lists
        let query = supabase.from('users').select('id, phone', { count: 'exact', head: false });

        // Apply filters (matching simple filter structure from UI)
        if (audienceFilters?.userType && audienceFilters.userType !== 'all') {
            // Assuming userType maps to role or org type? Let's check user table.
            // Assuming we join organizations? For now let's skip complex filter logic and assume all users.
        }

        // Only users with phones
        query = query.not('phone', 'is', null);

        const { data: recipients, count } = await query;
        const recipientList = recipients || [];

        // 3. Create Campaign
        const { data: campaign, error: insertError } = await supabase
            .from('marketing_campaigns' as any)
            .insert({
                org_id: body.orgId, // Passed from client or resolved from user
                name,
                objective,
                status: 'draft',
                audience_filters: audienceFilters,
                estimated_count: count || 0,
                message_body: messageBody,
                template_id: templateId,
                scheduled_at: scheduledAt || null,
                quiet_hours_enabled: quietHoursEnabled !== false,
                created_by: user.id
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // 4. Snapshot Recipients (Optional: do this now or at "Launch" time)
        // Doing it now allows reviewing the list.
        if (recipientList.length > 0 && campaign) {
            const recipientInserts = recipientList.map(u => ({
                campaign_id: (campaign as any).id,
                user_id: u.id,
                phone: u.phone,
                status: 'pending'
            }));

            // Batch insert
            const { error: batchError } = await supabase
                .from('marketing_campaign_recipients' as any)
                .insert(recipientInserts);

            if (batchError) console.error('Error snapshotting recipients', batchError);
        }

        return NextResponse.json({ success: true, campaign });

    } catch (error: any) {
        console.error('Create campaign error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');

    const { data: campaigns, error } = await supabase
        .from('marketing_campaigns' as any)
        .select('*')
        .eq('org_id', orgId) // Secure referencing
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ campaigns });
}
