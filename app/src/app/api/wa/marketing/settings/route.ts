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
    .select('organization_id')
    .eq('id', user.id)
    .single();

  const orgId = userProfile?.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

  let { data, error } = await supabase
    .from('marketing_settings' as any)
    .select('*')
    .eq('org_id', orgId)
    .single();

  if (error && error.code === 'PGRST116') {
      // Not found, return defaults
      return NextResponse.json({
          throttle_per_minute: 20,
          jitter_seconds_min: 1,
          jitter_seconds_max: 3,
          auto_pause_failure_rate: 15,
          content_max_links: 1,
          content_max_length: 1000
      });
  }

  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  const orgId = userProfile?.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

  const body = await request.json();

  const { data, error } = await supabase
    .from('marketing_settings' as any)
    .upsert({
        org_id: orgId,
        ...body,
        updated_at: new Date().toISOString()
    })
    .select()
    .single();
    
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
