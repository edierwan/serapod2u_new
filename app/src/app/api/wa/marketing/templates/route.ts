import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateTemplate } from '@/lib/template-safety';

export async function GET(request: Request) {
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

  const orgId = userProfile?.organization_id;

  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  // Fetch system templates + org templates
  const { data, error } = await supabase
    .from('marketing_templates' as any)
    .select('*')
    .or(`org_id.eq.${orgId},is_system.eq.true`)
    .order('created_at', { ascending: false });

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
    const { name, category, body: templateBody, variables, risk_score, risk_flags } = body;

    // Server-side validation (never trust client)
    const validation = validateTemplate(templateBody || '');

    // Block if template has critical errors
    if (!validation.isValid) {
      return NextResponse.json({
        error: 'Template validation failed',
        errors: validation.errors
      }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('marketing_templates' as any)
      .insert({
        org_id: userProfile.organization_id,
        name,
        category,
        body: templateBody,
        variables: variables || [],
        risk_score: validation.riskScore,
        risk_flags: validation.riskFlags.map(f => f.code),
        link_count: validation.metadata.linkCount,
        link_domains: validation.metadata.linkDomains,
        personalization_tokens: validation.metadata.personalizationTokens,
        content_hash: validation.metadata.normalizedContentHash,
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
