import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('marketing_segments' as any)
        .select('*')
        .eq('id', params.id)
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile with role
    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id, role_code')
        .eq('id', user.id)
        .single();

    try {
        // Check if user is super admin - can delete any segment
        const isSuperAdmin = userProfile?.role_code === 'SUPER_ADMIN';
        
        let deleteQuery = supabase
            .from('marketing_segments' as any)
            .delete()
            .eq('id', params.id);

        // Only restrict by org_id for non-super admins
        if (!isSuperAdmin && userProfile?.organization_id) {
            deleteQuery = deleteQuery.eq('org_id', userProfile.organization_id);
        }

        const { error, count } = await deleteQuery;

        if (error) {
            console.error('Delete segment error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Delete segment exception:', err);
        return NextResponse.json({ error: err.message || 'Failed to delete segment' }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user org
    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

    if (!userProfile?.organization_id) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    try {
        const body = await req.json();
        const { name, description, filters, estimated_count } = body;

        const { data, error } = await supabase
            .from('marketing_segments' as any)
            .update({
                name,
                description,
                filters,
                estimated_count,
                updated_at: new Date().toISOString()
            })
            .eq('id', params.id)
            .eq('org_id', userProfile.organization_id)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
