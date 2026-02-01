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

        // First, get the TOTAL count of all active users (this is what User Management shows)
        const { count: totalAllUsers } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('is_active', true);

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

        // Check if we need point-based filtering (requires the view)
        const needsPointsView = 
            activeFilters.points_min != null || activeFilters.points_max != null ||
            activeFilters.collected_system_min != null || activeFilters.collected_system_max != null ||
            activeFilters.collected_manual_min != null || activeFilters.collected_manual_max != null ||
            activeFilters.migration_points_min != null || activeFilters.migration_points_max != null ||
            activeFilters.total_redeemed_min != null || activeFilters.total_redeemed_max != null ||
            activeFilters.transactions_count_min != null || activeFilters.transactions_count_max != null ||
            activeFilters.last_activity_after != null || activeFilters.last_activity_before != null ||
            (activeFilters.inactive_days != null && activeFilters.never_login !== true);

        let users: any[] = [];
        let viewQuerySucceeded = false;

        if (needsPointsView) {
            try {
                // Use pagination to fetch ALL users from view (overcome Supabase 1000 row limit)
                const PAGE_SIZE = 1000;
                let offset = 0;
                let hasMore = true;
                const allViewUsers: any[] = [];

                while (hasMore) {
                    let query = supabase.from('v_consumer_points_summary' as any).select('*', { count: 'exact' });

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
                    query = query.range(offset, offset + PAGE_SIZE - 1);

                    const { data, error, count } = await query;

                    if (error) {
                        console.warn('View query failed:', error);
                        break;
                    }

                    if (data && data.length > 0) {
                        allViewUsers.push(...data);
                        offset += PAGE_SIZE;
                        hasMore = count ? allViewUsers.length < count : data.length === PAGE_SIZE;
                    } else {
                        hasMore = false;
                    }
                }

                if (allViewUsers.length > 0) {
                    users = allViewUsers;
                    viewQuerySucceeded = true;
                }
            } catch (e) {
                console.warn('View not available, using basic query:', e);
            }
        }

        // Use basic users query when no point filters needed OR as fallback
        if (!needsPointsView || !viewQuerySucceeded) {
            // Use pagination to fetch ALL users (overcome Supabase 1000 row limit)
            const PAGE_SIZE = 1000;
            let offset = 0;
            let hasMore = true;
            const allUsers: any[] = [];

            while (hasMore) {
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
                `, { count: 'exact' });

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
                query = query.range(offset, offset + PAGE_SIZE - 1);

                const { data, error, count } = await query;

                if (error) {
                    console.error('Error fetching users:', error);
                    throw error;
                }

                if (data && data.length > 0) {
                    allUsers.push(...data);
                    offset += PAGE_SIZE;
                    hasMore = count ? allUsers.length < count : data.length === PAGE_SIZE;
                } else {
                    hasMore = false;
                }
            }

            // Transform to common format
            users = allUsers.map((u: any) => ({
                user_id: u.id,
                name: u.full_name,
                whatsapp_phone: u.phone,
                whatsapp_valid: u.phone && u.phone.trim().length >= 8,
                state: u.location,
                organization_id: u.organization_id,
                organization_type: u.organizations?.org_type_code || (u.organization_id ? 'Organization' : 'End User'),
                org_name: u.organizations?.org_name,
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

        // Fetch scan data if needed for activity filters (Never Login, Never Scanned)
        // These filters only apply to End Users (organization_id IS NULL)
        // We use consumer_qr_scans table which tracks actual QR code scans/activations
        const needsActivationData = activeFilters.never_login === true || 
                                    activeFilters.never_scanned === true || 
                                    activeFilters.inactive_days != null;
        
        // Set of user IDs who have scanned QR codes (activated)
        const activatedUserIds = new Set<string>();
        const activationDates = new Map<string, Date>(); // user_id -> last_scanned_at
        
        if (needsActivationData) {
            try {
                // Fetch from consumer_qr_scans - this tracks all QR scans
                // consumer_id is the user who scanned
                const { data: scans } = await supabase
                   .from('consumer_qr_scans' as any)
                   .select('consumer_id, scanned_at')
                   .order('scanned_at', { ascending: false });
                   
                if (scans) {
                    scans.forEach((s: any) => {
                        if (!s.consumer_id) return;
                        activatedUserIds.add(s.consumer_id);
                        // Track latest scan date for inactive_days filter
                        if (!activationDates.has(s.consumer_id)) {
                            activationDates.set(s.consumer_id, new Date(s.scanned_at));
                        }
                    });
                }
                console.log(`[Audience] Found ${activatedUserIds.size} users who have scanned QR codes`);
            } catch (e) {
                console.warn('Error fetching scan data:', e);
            }
        }

        // Post-processing
        let totalMatched = users.length;
        let validPhones = 0;
        let excludedMissingPhone = 0;
        let excludedOptOut = 0;
        let excludedInvalidWA = 0;
        let excludedActivity = 0;
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

            // Activity Filters - these only apply to END USERS (organization_id IS NULL)
            // Never Login / Never Scanned: Filter users who have NEVER scanned a QR code
            // We check consumer_qr_scans table for actual scan records
            if (needsActivationData) {
                const isEndUser = !u.organization_id;
                const hasScanned = activatedUserIds.has(u.user_id);
                
                // Never Login (No Activations): ONLY include End Users who have NEVER scanned
                // If toggle is ON, we want users who NEVER logged in, so EXCLUDE those who HAVE scanned
                if (activeFilters.never_login === true) {
                    // This filter only makes sense for End Users
                    if (!isEndUser) {
                        // Non-end users are excluded when this filter is active (we only want independent consumers)
                        excludedActivity++;
                        return;
                    }
                    if (hasScanned) {
                        // User has logged in/scanned before - EXCLUDE them
                        excludedActivity++;
                        return;
                    }
                    // User is End User and has never scanned - KEEP them
                }

                // Never Scanned QR code: Same logic as Never Login
                // ONLY include End Users who have collected_system = 0 AND no scan records
                if (activeFilters.never_scanned === true) {
                    // This filter only makes sense for End Users
                    if (!isEndUser) {
                        excludedActivity++;
                        return;
                    }
                    if (hasScanned) {
                        // User has scanned QR before - EXCLUDE them
                        excludedActivity++;
                        return;
                    }
                    // Also check collected_system from points view (if available)
                    if (u.collected_system > 0) {
                        excludedActivity++;
                        return;
                    }
                    // User is End User and has never scanned - KEEP them
                }

                // Inactive Days: Check if they have recent scan activity
                if (activeFilters.inactive_days != null) {
                    const lastScan = activationDates.get(u.user_id);
                    let trueLastActivity = u.last_activity_at ? new Date(u.last_activity_at) : null;
                    
                    if (lastScan) {
                        if (!trueLastActivity || lastScan > trueLastActivity) {
                            trueLastActivity = lastScan;
                        }
                    }

                    if (trueLastActivity) {
                        const cutoff = new Date();
                        cutoff.setDate(cutoff.getDate() - activeFilters.inactive_days);
                        
                        if (trueLastActivity > cutoff) {
                            // Activity is more recent than cutoff -> User is ACTIVE -> Exclude
                            excludedActivity++;
                            return;
                        }
                    }
                    // If no activity ever, they are considered Inactive (Keep them)
                }
            }

            validPhones++;
            eligibleUsers.push({
                id: u.user_id,
                name: u.name || 'Unknown',
                phone: phone,
                state: u.state,
                organization_type: u.organization_type || (u.organization_id ? 'Organization' : 'End User'),
                org_name: u.org_name || (u.organization_id ? 'Organization' : 'End User'),
                current_balance: u.current_balance,
                collected_system: u.collected_system,
                transactions_count: u.transactions_count
            });
        });

        return NextResponse.json({
            total_all_users: totalAllUsers || 0,  // Total users in system (what User Management shows)
            total_matched: totalMatched,          // Users matching the current filters
            eligible_count: validPhones,          // Users with valid WhatsApp phones
            excluded_missing_phone: excludedMissingPhone,
            excluded_opt_out: excludedOptOut,
            excluded_invalid_wa: excludedInvalidWA,
            excluded_activity: excludedActivity,
            excluded_total: excludedMissingPhone + excludedOptOut + excludedInvalidWA + excludedActivity,
            preview: eligibleUsers.slice(0, 20),
            users: body.include_all ? eligibleUsers : undefined
        });

    } catch (err: any) {
        console.error('Audience resolve error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
