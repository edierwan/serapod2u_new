import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length >= 20 ? trimmed : null;
}

function normalizeIdArray(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeAudienceFilters(audienceFilters: any) {
  if (!audienceFilters || typeof audienceFilters !== 'object') {
    return {};
  }

  return {
    ...audienceFilters,
    segment_id: normalizeUuid(audienceFilters.segment_id),
    user_ids: normalizeIdArray(audienceFilters.user_ids),
    overrides: {
      include_ids: normalizeIdArray(audienceFilters.overrides?.include_ids),
      exclude_ids: normalizeIdArray(audienceFilters.overrides?.exclude_ids),
    },
  };
}

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
    .select(`
      *,
      creator:created_by (
        id,
        full_name
      )
    `)
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
    const { name, objective, audience_filters, message_body, template_id, scheduled_at, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, safety_preset_id } = body;

    // Validate inputs
    if (!name || !objective || !message_body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const normalizedAudienceFilters = normalizeAudienceFilters(audience_filters);
    const safeTemplateId = normalizeUuid(template_id);

    // Extract estimated_count from audience_filters
    const estimatedCount = normalizedAudienceFilters.estimated_count || 0;

    const status = scheduled_at ? 'scheduled' : 'draft';

    const { data, error } = await supabase
      .from('marketing_campaigns' as any)
      .insert({
        org_id: userProfile.organization_id,
        name,
        objective,
        status,
        audience_filters: normalizedAudienceFilters,
        estimated_count: estimatedCount,
        total_recipients: estimatedCount,
        message_body,
        template_id: safeTemplateId,
        scheduled_at,
        quiet_hours_enabled,
        quiet_hours_start,
        quiet_hours_end,
        safety_preset_id: safety_preset_id || null,
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
