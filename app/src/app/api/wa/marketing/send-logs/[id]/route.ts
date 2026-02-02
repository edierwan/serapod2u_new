import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
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

        // Delete the log (only if it belongs to user's organization)
        const { error } = await (supabase as any)
            .from('marketing_send_logs')
            .delete()
            .eq('id', id)
            .eq('company_id', orgId);

        if (error) {
            console.error('Error deleting send log:', error);
            return NextResponse.json({ error: 'Failed to delete log' }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error in delete send-log API:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
