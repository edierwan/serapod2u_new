import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Note: short_links table is created by migration. TypeScript types will be generated after migration.

// GET: List short links with pagination and search
export async function GET(request: Request) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

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

    const isSuperAdmin = roleLevel <= 1;

    let query = supabase
        .from('short_links')
        .select(`
      *,
      creator:created_by(id, full_name),
      updater:updated_by(id, full_name)
    `, { count: 'exact' })
        .order('created_at', { ascending: false });

    // Filter by org for non-super admins
    if (!isSuperAdmin && userProfile?.organization_id) {
        query = query.eq('org_id', userProfile.organization_id);
    }

    // Search by slug or label
    if (search) {
        query = query.or(`slug.ilike.%${search}%,label.ilike.%${search}%`);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        data,
        pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: Math.ceil((count || 0) / limit)
        }
    });
}

// POST: Create a new short link
export async function POST(request: Request) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated

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

    if (!userProfile?.organization_id) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    try {
        const body = await request.json();
        const { slug, label, destination_url, is_active, default_utm } = body;

        // Validate required fields
        if (!slug || !destination_url) {
            return NextResponse.json({ error: 'Slug and destination URL are required' }, { status: 400 });
        }

        // Validate slug format
        const slugRegex = /^[a-z0-9-]{3,60}$/;
        if (!slugRegex.test(slug)) {
            return NextResponse.json({
                error: 'Slug must be 3-60 characters, lowercase letters, numbers, and hyphens only'
            }, { status: 400 });
        }

        // Validate URL format
        try {
            new URL(destination_url);
        } catch {
            return NextResponse.json({ error: 'Invalid destination URL format' }, { status: 400 });
        }

        // Check for reserved slugs
        const reservedSlugs = ['admin', 'api', 'app', 'dashboard', 'login', 'logout', 'health'];
        if (reservedSlugs.includes(slug)) {
            return NextResponse.json({ error: 'This slug is reserved' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('short_links')
            .insert({
                org_id: userProfile.organization_id,
                slug,
                label: label || null,
                destination_url,
                is_active: is_active !== false,
                default_utm: default_utm || null,
                created_by: user.id,
                updated_by: user.id
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return NextResponse.json({ error: 'A short link with this slug already exists' }, { status: 409 });
            }
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
