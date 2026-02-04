import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Note: short_links table is created by migration. TypeScript types will be generated after migration.

// GET: Get single short link details with stats
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated
    const { id } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get short link with click stats
    const { data: shortLink, error } = await supabase
        .from('short_links')
        .select(`
      *,
      creator:created_by(id, full_name),
      updater:updated_by(id, full_name)
    `)
        .eq('id', id)
        .single();

    if (error || !shortLink) {
        return NextResponse.json({ error: 'Short link not found' }, { status: 404 });
    }

    // Get click stats
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalClicks, clicks24h, clicks7d] = await Promise.all([
        supabase
            .from('short_link_clicks')
            .select('id', { count: 'exact', head: true })
            .eq('short_link_id', id),
        supabase
            .from('short_link_clicks')
            .select('id', { count: 'exact', head: true })
            .eq('short_link_id', id)
            .gte('clicked_at', oneDayAgo.toISOString()),
        supabase
            .from('short_link_clicks')
            .select('id', { count: 'exact', head: true })
            .eq('short_link_id', id)
            .gte('clicked_at', sevenDaysAgo.toISOString())
    ]);

    return NextResponse.json({
        ...shortLink,
        stats: {
            total_clicks: totalClicks.count || 0,
            clicks_24h: clicks24h.count || 0,
            clicks_7d: clicks7d.count || 0
        }
    });
}

// PATCH: Update short link
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated
    const { id } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin access
    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id, role_code, roles!inner(role_level)')
        .eq('id', user.id)
        .single();

    const roleLevel = (userProfile?.roles as any)?.role_level || 100;
    if (roleLevel > 20) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { label, destination_url, is_active, default_utm } = body;

        // Build update object
        const updateData: any = {
            updated_by: user.id
        };

        if (label !== undefined) updateData.label = label;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (default_utm !== undefined) updateData.default_utm = default_utm;

        if (destination_url !== undefined) {
            // Validate URL format
            try {
                new URL(destination_url);
                updateData.destination_url = destination_url;
            } catch {
                return NextResponse.json({ error: 'Invalid destination URL format' }, { status: 400 });
            }
        }

        const { data, error } = await supabase
            .from('short_links')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Delete short link
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated
    const { id } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin access
    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id, role_code, roles!inner(role_level)')
        .eq('id', user.id)
        .single();

    const roleLevel = (userProfile?.roles as any)?.role_level || 100;
    if (roleLevel > 20) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { error } = await supabase
        .from('short_links')
        .delete()
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
