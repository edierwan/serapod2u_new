import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Organization types that should target organization contacts (company contact_phone)
const ORG_CONTACT_TYPES = ['DIST', 'MFG', 'SHOP', 'WH'];
// Organization types that should target individual users within those organizations
const ORG_USER_TYPES = ['HQ'];

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

        // First, get the TOTAL count of all active users
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

        // Determine organization types to target (support both single and multi-select)
        const orgTypes = activeFilters.organization_types || 
            (activeFilters.organization_type && activeFilters.organization_type !== 'All' && activeFilters.organization_type !== 'all' 
                ? [activeFilters.organization_type] 
                : []);
        
        console.log('[Audience Resolve] Raw filters:', JSON.stringify(activeFilters));
        console.log('[Audience Resolve] Determined orgTypes:', orgTypes);

        // Check what we're targeting
        const hasOrgContactTypes = orgTypes.some((t: string) => ORG_CONTACT_TYPES.includes(t));
        const hasOrgUserTypes = orgTypes.some((t: string) => ORG_USER_TYPES.includes(t));
        const hasEndUsers = orgTypes.includes('End User') || orgTypes.length === 0;
        const isAllTypes = orgTypes.length === 0 || orgTypes.includes('all') || orgTypes.includes('All') || orgTypes.includes('All Organization Types');

        console.log('[Audience Resolve] Flags:', { hasOrgContactTypes, hasOrgUserTypes, hasEndUsers, isAllTypes });

        // Location filter (support both single and multi-select)
        const locationStates = activeFilters.states || 
            (activeFilters.state && activeFilters.state !== 'Any Location' && activeFilters.state !== 'any' 
                ? [activeFilters.state] 
                : []);

        // Results containers
        let totalMatched = 0;
        let validPhones = 0;
        let excludedMissingPhone = 0;
        let excludedOptOut = 0;
        let excludedInvalidWA = 0;
        let excludedActivity = 0;
        let eligibleRecipients: any[] = [];

        // Fetch opt-outs if needed
        let optOutPhones = new Set<string>();
        if (activeFilters.opt_in_only !== false) {
            try {
                const { data: optOuts } = await supabase
                    .from('marketing_opt_outs' as any)
                    .select('phone');
                optOuts?.forEach((o: any) => optOutPhones.add(o.phone));
            } catch (e) {
                console.warn('Could not fetch opt-outs:', e);
            }
        }

        // ============================================
        // PART 0: Target Users in Organization Types (e.g., HQ)
        // This targets individual users who belong to organizations of specified types
        // Similar to User Management filter by Organization Type
        // ============================================
        console.log('[Audience Resolve] Processing HQ section:', {
            hasOrgUserTypes,
            isAllTypes,
            orgTypes,
            targetWillBeProcessed: (hasOrgUserTypes || isAllTypes) && mode !== 'specific_users'
        });

        if ((hasOrgUserTypes || isAllTypes) && mode !== 'specific_users') {
            const targetOrgUserTypes = isAllTypes 
                ? ORG_USER_TYPES 
                : orgTypes.filter((t: string) => ORG_USER_TYPES.includes(t));

            console.log('[Audience Resolve] HQ targeting org types:', targetOrgUserTypes);

            if (targetOrgUserTypes.length > 0) {
                // Step 1: Get all organization IDs that match the target types
                const { data: targetOrgs, error: orgError } = await supabase
                    .from('organizations')
                    .select('id, org_name, org_type_code, state_id, states!left(state_name)')
                    .eq('is_active', true)
                    .in('org_type_code', targetOrgUserTypes);

                console.log('[Audience Resolve] HQ organizations found:', targetOrgs?.length, 'Error:', orgError?.message);

                if (targetOrgs && targetOrgs.length > 0) {
                    // Apply location filter to organizations if needed
                    const filteredOrgs = locationStates.length > 0
                        ? targetOrgs.filter(org => {
                            const stateName = (org.states as any)?.state_name;
                            return stateName && locationStates.includes(stateName);
                        })
                        : targetOrgs;

                    const targetOrgIds = filteredOrgs.map(org => org.id);
                    console.log('[Audience Resolve] HQ filtered org IDs:', targetOrgIds.length);

                    if (targetOrgIds.length > 0) {
                        // Step 2: Get ALL users that belong to these organizations
                        // Query similar to User Management
                        const PAGE_SIZE = 1000;
                        let offset = 0;
                        let hasMore = true;
                        const allOrgUsers: any[] = [];

                        while (hasMore) {
                            const { data: usersData, error: userError, count } = await supabase
                                .from('users')
                                .select(`
                                    id,
                                    full_name,
                                    phone,
                                    location,
                                    organization_id,
                                    is_active
                                `, { count: 'exact' })
                                .eq('is_active', true)
                                .in('organization_id', targetOrgIds)
                                .range(offset, offset + PAGE_SIZE - 1);

                            console.log('[Audience Resolve] HQ users query result:', { 
                                usersCount: usersData?.length, 
                                totalCount: count, 
                                error: userError?.message,
                                sampleUser: usersData?.[0]
                            });

                            if (userError) {
                                console.error('Error fetching org users:', userError);
                                break;
                            }

                            if (usersData && usersData.length > 0) {
                                allOrgUsers.push(...usersData);
                                offset += PAGE_SIZE;
                                hasMore = count ? allOrgUsers.length < count : usersData.length === PAGE_SIZE;
                            } else {
                                hasMore = false;
                            }
                        }

                        console.log('[Audience Resolve] HQ total users fetched:', allOrgUsers.length);

                        // Create org lookup map for faster access
                        const orgMap = new Map(filteredOrgs.map(org => [org.id, org]));

                        // Process users
                        for (const u of allOrgUsers) {
                            const phone = u.phone?.trim();
                            const org = orgMap.get(u.organization_id);
                            const stateName = (org?.states as any)?.state_name || u.location;

                            totalMatched++;

                            // Check for valid phone
                            if (!phone || phone.length < 8) {
                                excludedMissingPhone++;
                                continue;
                            }

                            // Check opt-out
                            if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                                excludedOptOut++;
                                continue;
                            }

                            validPhones++;
                            eligibleRecipients.push({
                                id: u.id,
                                name: u.full_name || 'Unknown',
                                phone: phone,
                                state: stateName || 'No Location',
                                organization_type: org?.org_type_code || 'Unknown',
                                org_name: org?.org_name || 'Unknown',
                                is_organization_user: true
                            });
                        }
                    }
                }
            }
        }

        // ============================================
        // PART 1: Target Organizations (DIST, MFG, SHOP, WH)
        // Uses organization's contact_phone, not individual user phones
        // NOTE: This should NOT run when ONLY HQ-type organizations are selected
        // HQ users are handled in PART 0
        // ============================================
        // Explicitly exclude HQ from PART 1 - HQ should only return users, not org contacts
        const onlyHQSelected = orgTypes.length > 0 && orgTypes.every((t: string) => ORG_USER_TYPES.includes(t));
        const shouldRunPart1 = (hasOrgContactTypes || isAllTypes) && mode !== 'specific_users' && !onlyHQSelected;
        console.log('[Audience Resolve] PART 1 will run?', shouldRunPart1, { hasOrgContactTypes, isAllTypes, onlyHQSelected });
        
        if (shouldRunPart1) {
            const targetOrgTypes = isAllTypes 
                ? ORG_CONTACT_TYPES 
                : orgTypes.filter((t: string) => ORG_CONTACT_TYPES.includes(t));

            console.log('[Audience Resolve] PART 1 targetOrgTypes:', targetOrgTypes);

            if (targetOrgTypes.length > 0) {
                // Fetch organizations with pagination
                const PAGE_SIZE = 1000;
                let offset = 0;
                let hasMore = true;
                const allOrgs: any[] = [];

                while (hasMore) {
                    let query = supabase.from('organizations')
                        .select(`
                            id,
                            org_name,
                            org_type_code,
                            contact_name,
                            contact_phone,
                            state_id,
                            states!left (state_name)
                        `, { count: 'exact' })
                        .eq('is_active', true)
                        .in('org_type_code', targetOrgTypes);

                    query = query.range(offset, offset + PAGE_SIZE - 1);

                    const { data, error, count } = await query;

                    if (error) {
                        console.error('Error fetching organizations:', error);
                        throw error;
                    }

                    if (data && data.length > 0) {
                        allOrgs.push(...data);
                        offset += PAGE_SIZE;
                        hasMore = count ? allOrgs.length < count : data.length === PAGE_SIZE;
                    } else {
                        hasMore = false;
                    }
                }

                // Process organizations
                for (const org of allOrgs) {
                    const phone = org.contact_phone?.trim();
                    const stateName = (org.states as any)?.state_name;

                    // Apply location filter
                    if (locationStates.length > 0 && stateName && !locationStates.includes(stateName)) {
                        continue; // Skip if location doesn't match
                    }

                    totalMatched++;

                    // Check for valid phone
                    if (!phone || phone.length < 8) {
                        excludedMissingPhone++;
                        continue;
                    }

                    // Check opt-out
                    if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                        excludedOptOut++;
                        continue;
                    }

                    validPhones++;
                    eligibleRecipients.push({
                        id: org.id,
                        name: org.contact_name || org.org_name,
                        phone: phone,
                        state: stateName || 'No Location',
                        organization_type: org.org_type_code,
                        org_name: org.org_name,
                        is_organization: true
                    });
                }
            }
        }

        // ============================================
        // PART 2: Target End Users (individuals without organization)
        // Keep existing logic for End Users only
        // ============================================
        if ((hasEndUsers || isAllTypes || mode === 'specific_users') && 
            !((hasOrgContactTypes || hasOrgUserTypes) && !hasEndUsers && !isAllTypes)) {
            
            // Check if we need point-based filtering
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
                    const PAGE_SIZE = 1000;
                    let offset = 0;
                    let hasMore = true;
                    const allViewUsers: any[] = [];

                    while (hasMore) {
                        let query = supabase.from('v_consumer_points_summary' as any).select('*', { count: 'exact' });

                        if (mode === 'specific_users' && user_ids && user_ids.length > 0) {
                            query = query.in('user_id', user_ids);
                        } else {
                            // End Users only: users with no organization_id
                            query = query.is('organization_id', null);

                            // Location Filter
                            if (locationStates.length > 0) {
                                query = query.in('state', locationStates);
                            }

                            // Point-based filters
                            if (activeFilters.points_min != null) query = query.gte('current_balance', activeFilters.points_min);
                            if (activeFilters.points_max != null) query = query.lte('current_balance', activeFilters.points_max);
                            if (activeFilters.collected_system_min != null) query = query.gte('collected_system', activeFilters.collected_system_min);
                            if (activeFilters.collected_system_max != null) query = query.lte('collected_system', activeFilters.collected_system_max);
                            if (activeFilters.collected_manual_min != null) query = query.gte('collected_manual', activeFilters.collected_manual_min);
                            if (activeFilters.collected_manual_max != null) query = query.lte('collected_manual', activeFilters.collected_manual_max);
                            if (activeFilters.migration_points_min != null) query = query.gte('migration_points', activeFilters.migration_points_min);
                            if (activeFilters.migration_points_max != null) query = query.lte('migration_points', activeFilters.migration_points_max);
                            if (activeFilters.total_redeemed_min != null) query = query.gte('total_redeemed', activeFilters.total_redeemed_min);
                            if (activeFilters.total_redeemed_max != null) query = query.lte('total_redeemed', activeFilters.total_redeemed_max);
                            if (activeFilters.transactions_count_min != null) query = query.gte('transactions_count', activeFilters.transactions_count_min);
                            if (activeFilters.transactions_count_max != null) query = query.lte('transactions_count', activeFilters.transactions_count_max);

                            // Activity filters
                            if (activeFilters.last_activity_after) query = query.gte('last_activity_at', activeFilters.last_activity_after);
                            if (activeFilters.last_activity_before) query = query.lte('last_activity_at', activeFilters.last_activity_before);
                            if (activeFilters.inactive_days != null) {
                                const cutoffDate = new Date();
                                cutoffDate.setDate(cutoffDate.getDate() - activeFilters.inactive_days);
                                query = query.lte('last_activity_at', cutoffDate.toISOString());
                            }
                            if (activeFilters.never_scanned === true) query = query.eq('collected_system', 0);
                        }

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
                        is_active
                    `, { count: 'exact' });

                    if (mode === 'specific_users' && user_ids && user_ids.length > 0) {
                        query = query.in('id', user_ids);
                    } else {
                        // End Users only: users with no organization_id
                        query = query.is('organization_id', null);
                        
                        if (locationStates.length > 0) {
                            query = query.in('location', locationStates);
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
                    organization_type: 'End User',
                    org_name: 'End User',
                    current_balance: 0,
                    collected_system: 0
                }));
            }

            // Fetch scan data if needed for activity filters
            const needsActivationData = activeFilters.never_login === true ||
                activeFilters.never_scanned === true ||
                activeFilters.inactive_days != null;

            const activatedUserIds = new Set<string>();
            const activationDates = new Map<string, Date>();

            if (needsActivationData) {
                try {
                    const { data: scans } = await supabase
                        .from('consumer_qr_scans' as any)
                        .select('consumer_id, scanned_at')
                        .order('scanned_at', { ascending: false });

                    if (scans) {
                        scans.forEach((s: any) => {
                            if (!s.consumer_id) return;
                            activatedUserIds.add(s.consumer_id);
                            if (!activationDates.has(s.consumer_id)) {
                                activationDates.set(s.consumer_id, new Date(s.scanned_at));
                            }
                        });
                    }
                } catch (e) {
                    console.warn('Error fetching scan data:', e);
                }
            }

            // Process End Users
            for (const u of users) {
                const phone = u.whatsapp_phone?.trim();
                totalMatched++;

                // Check for valid phone
                if (!phone || phone.length < 8) {
                    excludedMissingPhone++;
                    continue;
                }

                // Check valid WhatsApp
                if (activeFilters.only_valid_whatsapp !== false && !u.whatsapp_valid) {
                    excludedInvalidWA++;
                    continue;
                }

                // Check opt-out
                if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                    excludedOptOut++;
                    continue;
                }

                // Activity Filters for End Users
                if (needsActivationData) {
                    const hasScanned = activatedUserIds.has(u.user_id);

                    if (activeFilters.never_login === true && hasScanned) {
                        excludedActivity++;
                        continue;
                    }

                    if (activeFilters.never_scanned === true) {
                        if (hasScanned || u.collected_system > 0) {
                            excludedActivity++;
                            continue;
                        }
                    }

                    if (activeFilters.inactive_days != null) {
                        const lastScan = activationDates.get(u.user_id);
                        let trueLastActivity = u.last_activity_at ? new Date(u.last_activity_at) : null;

                        if (lastScan && (!trueLastActivity || lastScan > trueLastActivity)) {
                            trueLastActivity = lastScan;
                        }

                        if (trueLastActivity) {
                            const cutoff = new Date();
                            cutoff.setDate(cutoff.getDate() - activeFilters.inactive_days);

                            if (trueLastActivity > cutoff) {
                                excludedActivity++;
                                continue;
                            }
                        }
                    }
                }

                validPhones++;
                eligibleRecipients.push({
                    id: u.user_id,
                    name: u.name || 'Unknown',
                    phone: phone,
                    state: u.state || 'No Location',
                    organization_type: 'End User',
                    org_name: 'End User',
                    current_balance: u.current_balance,
                    collected_system: u.collected_system
                });
            }
        }

        return NextResponse.json({
            total_all_users: totalAllUsers || 0,
            total_matched: totalMatched,
            eligible_count: validPhones,
            excluded_missing_phone: excludedMissingPhone,
            excluded_opt_out: excludedOptOut,
            excluded_invalid_wa: excludedInvalidWA,
            excluded_activity: excludedActivity,
            excluded_total: excludedMissingPhone + excludedOptOut + excludedInvalidWA + excludedActivity,
            preview: eligibleRecipients.slice(0, 20),
            users: body.include_all ? eligibleRecipients : undefined
        });

    } catch (err: any) {
        console.error('Audience resolve error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
