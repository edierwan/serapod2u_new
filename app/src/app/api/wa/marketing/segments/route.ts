import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, role_code')
    .eq('id', user.id)
    .single();

  // Super admin can see all segments, others only see their org's segments
  const isSuperAdmin = userProfile?.role_code === 'SUPER_ADMIN';

  let query = supabase
    .from('marketing_segments' as any)
    .select(`
      *,
      creator:created_by(id, full_name)
    `)
    .order('created_at', { ascending: false });

  // Only filter by org for non-super admins
  if (!isSuperAdmin && userProfile?.organization_id) {
    query = query.eq('org_id', userProfile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!userProfile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { name, description, filters, estimated_count } = body;

    const { data, error } = await supabase
      .from('marketing_segments' as any)
      .insert({
        org_id: userProfile.organization_id,
        name,
        description,
        filters: filters || {},
        estimated_count,
        created_by: user.id
      })
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
