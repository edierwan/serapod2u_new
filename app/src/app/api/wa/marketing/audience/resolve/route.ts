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

        // Try to use the view first, fall back to basic query
        let users: any[] = [];
        let useBasicQuery = false;

        try {
            // Try using the v_consumer_points_summary view for point-based filtering
            let query = supabase.from('v_consumer_points_summary' as any).select('*');

            // Apply filters
            if (mode === 'specific_users' && user_ids && user_ids.length > 0) {
                query = query.in('user_id', user_ids);
            } else {
                // Organization Type Filter
                if (activeFilters.organization_type && activeFilters.organization_type !== 'All' && activeFilters.organization_type !== 'all') {
                    if (activeFilters.organization_type === 'End User') {
                        query = query.is('organization_id', null);
                    } else {
                        query = query.eq('organization_type', activeFilters.organization_type);
                    }
                }

                // Location Filter
                if (activeFilters.state && activeFilters.state !== 'Any Location' && activeFilters.state !== 'any') {
                    query = query.eq('state', activeFilters.state);
                }

                // Point-based filters
                if (activeFilters.points_min != null) {
                    query = query.gte('current_balance', activeFilters.points_min);
                }
                if (activeFilters.points_max != null) {
                    query = query.lte('current_balance', activeFilters.points_max);
                }
                if (activeFilters.collected_system_min != null) {
                    query = query.gte('collected_system', activeFilters.collected_system_min);
                }
                if (activeFilters.collected_system_max != null) {
                    query = query.lte('collected_system', activeFilters.collected_system_max);
                }
                if (activeFilters.collected_manual_min != null) {
                    query = query.gte('collected_manual', activeFilters.collected_manual_min);
                }
                if (activeFilters.collected_manual_max != null) {
                    query = query.lte('collected_manual', activeFilters.collected_manual_max);
                }
                if (activeFilters.migration_points_min != null) {
                    query = query.gte('migration_points', activeFilters.migration_points_min);
                }
                if (activeFilters.migration_points_max != null) {
                    query = query.lte('migration_points', activeFilters.migration_points_max);
                }
                if (activeFilters.total_redeemed_min != null) {
                    query = query.gte('total_redeemed', activeFilters.total_redeemed_min);
                }
                if (activeFilters.total_redeemed_max != null) {
                    query = query.lte('total_redeemed', activeFilters.total_redeemed_max);
                }
                if (activeFilters.transactions_count_min != null) {
                    query = query.gte('transactions_count', activeFilters.transactions_count_min);
                }
                if (activeFilters.transactions_count_max != null) {
                    query = query.lte('transactions_count', activeFilters.transactions_count_max);
                }

                // Activity filters
                if (activeFilters.last_activity_after) {
                    query = query.gte('last_activity_at', activeFilters.last_activity_after);
                }
                if (activeFilters.last_activity_before) {
                    query = query.lte('last_activity_at', activeFilters.last_activity_before);
                }
                if (activeFilters.inactive_days != null) {
                    const cutoffDate = new Date();
                    cutoffDate.setDate(cutoffDate.getDate() - activeFilters.inactive_days);
                    query = query.lte('last_activity_at', cutoffDate.toISOString());
                }
                if (activeFilters.never_scanned === true) {
                    query = query.eq('collected_system', 0);
                }
            }

            // Only active users
            query = query.eq('is_active', true);

            const { data, error } = await query as any;

            if (error) {
                console.warn('View query failed, falling back to basic query:', error);
                useBasicQuery = true;
            } else {
                users = data || [];
            }
        } catch (e) {
            console.warn('View not available, using basic query:', e);
            useBasicQuery = true;
        }

        // Fallback to basic users query if view is not available
        if (useBasicQuery) {
            let query = supabase.from('users' as any).select(`
                id, 
                full_name, 
                phone, 
                location, 
                organization_id,
                is_active,
                organizations!fk_users_organization (
                    id,
                    org_type_code, 
                    org_name
                )
            `);

            if (mode === 'specific_users' && user_ids && user_ids.length > 0) {
                query = query.in('id', user_ids);
            } else {
                if (activeFilters.organization_type && activeFilters.organization_type !== 'All' && activeFilters.organization_type !== 'all') {
                    if (activeFilters.organization_type === 'End User') {
                        query = query.is('organization_id', null);
                    } else {
                        query = query.eq('organizations.org_type_code', activeFilters.organization_type);
                    }
                }
                if (activeFilters.state && activeFilters.state !== 'Any Location' && activeFilters.state !== 'any') {
                    query = query.eq('location', activeFilters.state);
                }
            }

            query = query.eq('is_active', true);

            const { data, error } = await query as any;

            if (error) {
                console.error('Error fetching users:', error);
                throw error;
            }

            // Transform to common format
            users = (data || []).map((u: any) => ({
                user_id: u.id,
                name: u.full_name,
                whatsapp_phone: u.phone,
                whatsapp_valid: u.phone && u.phone.trim().length >= 8,
                state: u.location,
                organization_type: u.organizations?.org_type_code,
                current_balance: 0,
                collected_system: 0,
                collected_manual: 0,
                migration_points: 0,
                total_redeemed: 0,
                transactions_count: 0
            }));
        }

        // Fetch opt-outs if needed
        let optOutPhones = new Set<string>();
        if (activeFilters.opt_in_only !== false) {
            try {
                const { data: optOuts } = await supabase
                    .from('marketing_opt_outs' as any)
                    .select('phone');

                optOuts?.forEach((o: any) => optOutPhones.add(o.phone));
            } catch (e) {
                console.warn('Could not fetch opt-outs (table might be missing)', e);
            }
        }

        // Post-processing
        let totalMatched = users.length;
        let validPhones = 0;
        let excludedMissingPhone = 0;
        let excludedOptOut = 0;
        let excludedInvalidWA = 0;
        let eligibleUsers: any[] = [];

        users.forEach((u: any) => {
            const phone = u.whatsapp_phone?.trim();

            // Check for valid phone
            if (!phone || phone.length < 8) {
                excludedMissingPhone++;
                return;
            }

            // Check valid WhatsApp (basic validation)
            if (activeFilters.only_valid_whatsapp !== false && !u.whatsapp_valid) {
                excludedInvalidWA++;
                return;
            }

            // Check opt-out
            if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                excludedOptOut++;
                return;
            }

            validPhones++;
            eligibleUsers.push({
                id: u.user_id,
                name: u.name || 'Unknown',
                phone: phone,
                state: u.state,
                organization_type: u.organization_type,
                current_balance: u.current_balance,
                collected_system: u.collected_system,
                transactions_count: u.transactions_count
            });
        });

        return NextResponse.json({
            total_matched: totalMatched,
            eligible_count: validPhones,
            excluded_missing_phone: excludedMissingPhone,
            excluded_opt_out: excludedOptOut,
            excluded_invalid_wa: excludedInvalidWA,
            excluded_total: excludedMissingPhone + excludedOptOut + excludedInvalidWA,
            preview: eligibleUsers.slice(0, 20)
        });

    } catch (err: any) {
        console.error('Audience resolve error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
