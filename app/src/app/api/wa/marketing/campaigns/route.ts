import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get user's org
  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!userProfile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  let query = supabase
    .from('marketing_campaigns' as any)
    .select('*')
    .eq('org_id', userProfile.organization_id)
    .order('updated_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
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

  // Get user's org
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
    const { name, objective, audience_filters, message_body, template_id, scheduled_at, quiet_hours_enabled, quiet_hours_start, quiet_hours_end } = body;

    // Validate inputs
    if (!name || !objective || !message_body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Ensure template_id is a valid UUID or NULL
    let safeTemplateId = template_id;
    if (safeTemplateId && typeof safeTemplateId === 'string') {
        // Basic UUID validation (or just check length/format)
        // If it looks like "2" or short string, set to null to avoid DB crash
        if (safeTemplateId.length < 20) { // UUIDs are 36 chars
            safeTemplateId = null;
        }
    }

    const { data, error } = await supabase
      .from('marketing_campaigns' as any)
      .insert({
        org_id: userProfile.organization_id,
        name,
        objective,
        status: 'draft',
        audience_filters: audience_filters || {},
        message_body,
        template_id: safeTemplateId,
        scheduled_at,
        quiet_hours_enabled,
        quiet_hours_start,
        quiet_hours_end,
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
        console.error("Create campaign error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
