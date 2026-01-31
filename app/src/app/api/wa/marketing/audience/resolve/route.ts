import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { mode, filters, segment_id, user_ids } = body;

    // Determine effective filters
    let activeFilters = filters || {};
    if (mode === 'segment' && segment_id) {
      const { data: segment } = await supabase
        .from('marketing_segments' as any)
        .select('filters')
        .eq('id', segment_id)
        .single();
      
      if (segment) {
        activeFilters = (segment as any).filters;
      }
    }

    // Prepare query
    // We need to filter based on organization type, so we need to join organizations
    // Using left join (removing !inner) to include users without organization (End Users)
    let query = supabase.from('users' as any).select(`
      id, 
      full_name, 
      phone, 
      location, 
      organization_id,
      organizations!fk_users_organization (
        id,
        org_type_code, 
        org_name
      )
    `);

    // 1. Basic Filters
    if (mode === 'specific_users' && user_ids && user_ids.length > 0) {
      query = query.in('id', user_ids);
    } else {
      // Apply Organization Type Filter
      if (activeFilters.organization_type && activeFilters.organization_type !== 'All' && activeFilters.organization_type !== 'all') {
        if (activeFilters.organization_type === 'End User') {
          // End Users defined as those without an organization linked
          query = query.is('organization_id', null);
        } else {
          // Filter using the nested relationship field
          query = query.eq('organizations.org_type_code', activeFilters.organization_type);
        }
      }

      // Apply Location Filter
      if (activeFilters.state && activeFilters.state !== 'Any Location' && activeFilters.state !== 'any') {
         // Using plain eq() because values come from DB. 
         // If whitespace issues persist, consider using a sanitized column or trimming in DB.
        query = query.eq('location', activeFilters.state);
      }
    }

    // Only active users
    query = query.eq('is_active', true);

    const { data: users, error } = await query as any;

    if (error) {
      console.error('Error fetching users:', error);
      throw error;
    }

    // 2. Post-processing (Phone Validation & Opt-outs)
    let allMatches: any[] = users || [];
    
    // Fetch opt-outs if needed
    let optOutPhones = new Set<string>();
    if (activeFilters.opt_in_only) {
      try {
        const { data: optOuts } = await supabase
          .from('marketing_opt_outs' as any)
          .select('phone');
          
        optOuts?.forEach((o: any) => optOutPhones.add(o.phone));
      } catch (e) {
        console.warn('Could not fetch opt-outs (table might be missing)', e);
      }
    }

    let totalMatched = allMatches.length;
    let validPhones = 0;
    let excludedMissingPhone = 0;
    let excludedOptOut = 0;
    let eligibleUsers: any[] = [];

    allMatches.forEach(u => {
      // Normalize phone (basic)
      if (!u.phone || u.phone.trim().length < 8) {
        excludedMissingPhone++;
        return;
      }

      const phone = u.phone.trim();
      
      // Check opt-out
      if (activeFilters.opt_in_only && optOutPhones.has(phone)) {
        excludedOptOut++;
        return;
      }

      validPhones++;
      eligibleUsers.push({
        id: u.id,
        name: u.full_name || 'Unknown',
        phone: phone,
        state: u.location,
        organization_type: (u as any).organizations?.org_type_code,
        org_name: (u as any).organizations?.org_name
      });
    });

    return NextResponse.json({
      total_matched: totalMatched,
      eligible_count: validPhones,
      excluded_missing_phone: excludedMissingPhone,
      excluded_opt_out: excludedOptOut,
      preview: eligibleUsers.slice(0, 20)
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
