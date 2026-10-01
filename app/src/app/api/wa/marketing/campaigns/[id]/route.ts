import { guardUserOperation } from '@/lib/security-access/operation'
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const saDenied = await guardUserOperation(user.id, 'customer.campaign.manage')
    if (saDenied) return saDenied

    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

    if (!userProfile?.organization_id) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    try {
        const { error } = await supabase
            .from('marketing_campaigns' as any)
            .delete()
            .eq('id', id)
            .eq('org_id', userProfile.organization_id);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Failed to delete campaign' }, { status: 500 });
    }
}