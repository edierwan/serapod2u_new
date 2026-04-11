import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { loadScopedShopUsers } from '@/app/api/admin/_user-management-scope';
import { isReportRowActive, normalizeReportStatusSettings } from '@/lib/engagement/report-status-settings';

// Organization types that should target organization contacts (company contact_phone)
const ORG_CONTACT_TYPES = ['DIST', 'MFG', 'SHOP', 'WH'];
// Organization types that should target individual users within those organizations
const ORG_USER_TYPES = ['HQ'];

function hasUsablePhone(phone?: string | null) {
    return Boolean(phone && phone.trim().length >= 8);
}

function toDateOrNull(value?: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function passesWinbackScanFilter(filters: any, lastScanAt?: string | null) {
    const mode = filters?.winback_last_scan_mode || 'any';
    const days = Number(filters?.winback_last_scan_days);
    const scanDate = toDateOrNull(lastScanAt);

    if (mode === 'any') return true;
    if (mode === 'no_scan') return !scanDate;
    if (!scanDate) return false;

    const cutoffDays = Number.isFinite(days) && days > 0 ? days : 30;
    const diffDays = (Date.now() - scanDate.getTime()) / (1000 * 60 * 60 * 24);

    if (mode === 'within_days') return diffDays <= cutoffDays;
    if (mode === 'older_than_days') return diffDays > cutoffDays;
    return true;
}

function passesWinbackPointsFilter(filters: any, pointsBalance?: number | null) {
    const minPoints = Number(filters?.winback_points_min);
    if (!Number.isFinite(minPoints)) return true;
    return Number(pointsBalance || 0) >= minPoints;
}

export async function POST(request: NextRequest) {
    const supabase = await createServerClient();

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { mode, filters, segment_id, user_ids, overrides } = body;

        // Extract override IDs
        const excludeIds = new Set<string>(overrides?.exclude_ids || []);
        const includeIds = new Set<string>(overrides?.include_ids || []);

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
        console.log('[Audience Resolve] Overrides - exclude:', excludeIds.size, 'include:', includeIds.size);

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
        let excludedRecipients: any[] = [];

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

        const isWinbackRequest = mode === 'filters' && Boolean(activeFilters.winback_category);

        if (isWinbackRequest) {
            const admin = createServiceClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { auth: { autoRefreshToken: false, persistSession: false } }
            );

            const { data: profile } = await admin
                .from('users')
                .select('role_code, organization_id')
                .eq('id', user.id)
                .single();

            if (!profile || !['SA', 'HQ', 'POWER_USER'].includes(profile.role_code)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            const { data: organization } = profile.organization_id
                ? await admin
                    .from('organizations')
                    .select('settings')
                    .eq('id', profile.organization_id)
                    .single()
                : { data: null as any };

            const reportStatusSettings = normalizeReportStatusSettings(organization?.settings);
            const winbackStatus = activeFilters.winback_status || 'all';

            const pushWinbackRecipient = (recipient: any, isActive: boolean, lastScanAt?: string | null, pointsBalance?: number | null) => {
                if (locationStates.length > 0 && recipient.state && !locationStates.includes(recipient.state)) {
                    return;
                }

                totalMatched++;

                if (!hasUsablePhone(recipient.phone)) {
                    excludedMissingPhone++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Missing/Invalid Phone' });
                    return;
                }

                if (activeFilters.only_valid_whatsapp !== false && recipient.whatsapp_valid === false) {
                    excludedInvalidWA++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Invalid WhatsApp' });
                    return;
                }

                if (activeFilters.opt_in_only !== false && optOutPhones.has(recipient.phone)) {
                    excludedOptOut++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Opt-out' });
                    return;
                }

                if (winbackStatus === 'active' && !isActive) {
                    excludedActivity++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Status (Inactive)' });
                    return;
                }

                if (winbackStatus === 'inactive' && isActive) {
                    excludedActivity++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Status (Active)' });
                    return;
                }

                if (!passesWinbackScanFilter(activeFilters, lastScanAt)) {
                    excludedActivity++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Last Scan Filter' });
                    return;
                }

                if (!passesWinbackPointsFilter(activeFilters, pointsBalance)) {
                    excludedActivity++;
                    excludedRecipients.push({ ...recipient, status: 'excluded', exclusion_reason: 'Points Filter' });
                    return;
                }

                validPhones++;
                eligibleRecipients.push({ ...recipient, status: 'eligible' });
            };

            if (activeFilters.winback_category === 'shop_performance') {
                const { data: shopOrganizations, error: shopOrganizationsError } = await admin
                    .from('organizations')
                    .select('id, org_name, contact_name, contact_phone, parent_org_id, states(state_name)')
                    .eq('is_active', true)
                    .eq('org_type_code', 'SHOP')
                    .order('org_name', { ascending: true });

                if (shopOrganizationsError) throw shopOrganizationsError;

                const { data: shopRows, error: shopRowsError } = await admin
                    .from('v_shop_points_summary')
                    .select('shop_id, shop_name, contact_name, contact_phone, state, total_points_balance, last_activity');

                if (shopRowsError) throw shopRowsError;

                const shopSummaryById = new Map((shopRows || []).map((row: any) => [row.shop_id, row]));

                const { shopUsers } = await loadScopedShopUsers(admin as any, profile.role_code, profile.organization_id);
                const shopUserIds = shopUsers.map((item) => item.id);
                const shopOrgByUserId = new Map(shopUsers.map((item) => [item.id, item.organization_id]));
                const lastScanByShopId = new Map<string, string>();
                const shopUsersByOrgId = new Map<string, any[]>();

                for (const staff of shopUsers) {
                    if (!staff.organization_id) continue;
                    const current = shopUsersByOrgId.get(staff.organization_id) || [];
                    current.push(staff);
                    shopUsersByOrgId.set(staff.organization_id, current);
                }

                for (let index = 0; index < shopUserIds.length; index += 100) {
                    const userIdChunk = shopUserIds.slice(index, index + 100);
                    if (userIdChunk.length === 0) continue;
                    const { data: scanRows, error: scanError } = await admin
                        .from('consumer_qr_scans')
                        .select('consumer_id, scanned_at')
                        .eq('claim_lane', 'shop')
                        .in('consumer_id', userIdChunk);

                    if (scanError) throw scanError;

                    for (const row of scanRows || []) {
                        const shopId = shopOrgByUserId.get(row.consumer_id);
                        if (!shopId || !row.scanned_at) continue;
                        const current = lastScanByShopId.get(shopId);
                        if (!current || row.scanned_at > current) {
                            lastScanByShopId.set(shopId, row.scanned_at);
                        }
                    }
                }

                for (const shop of shopOrganizations || []) {
                    const summary = shopSummaryById.get(shop.id);
                    const shopState = (shop.states as any)?.state_name || summary?.state || 'No Location';
                    const shopName = summary?.shop_name || shop.org_name;
                    const pointsBalance = Number(summary?.total_points_balance || 0);
                    const shopLastScanAt = lastScanByShopId.get(shop.id) || summary?.last_activity || null;
                    const isActive = isReportRowActive(pointsBalance, summary?.last_activity || null, reportStatusSettings.shopPerformance);

                    const recipient = {
                        id: shop.id,
                        name: summary?.contact_name || shop.contact_name || shopName,
                        phone: summary?.contact_phone || shop.contact_phone || 'No Phone',
                        state: shopState,
                        city: shopState || '',
                        organization_type: 'SHOP',
                        org_name: shopName,
                        is_organization: true,
                    };

                    pushWinbackRecipient(recipient, isActive, shopLastScanAt, pointsBalance);

                    for (const staff of shopUsersByOrgId.get(shop.id) || []) {
                        const staffRecipient = {
                            id: staff.id,
                            user_id: staff.id,
                            name: staff.full_name || recipient.name,
                            phone: staff.phone || 'No Phone',
                            state: shopState,
                            city: shopState || '',
                            organization_type: 'SHOP',
                            org_name: shopName,
                            is_organization_user: true,
                        };

                        pushWinbackRecipient(staffRecipient, isActive, shopLastScanAt, pointsBalance);
                    }
                }
            }

            if (activeFilters.winback_category === 'shop_staff_performance') {
                const { shopUsers } = await loadScopedShopUsers(admin as any, profile.role_code, profile.organization_id);
                const userIds = shopUsers.map((item) => item.id);
                const shopOrgIds = Array.from(new Set(shopUsers.map((item) => item.organization_id).filter(Boolean))) as string[];
                const statsByUser = new Map<string, { current_balance: number; last_transaction_date: string | null; last_scan_at: string | null }>();
                const { data: shopOrgs } = shopOrgIds.length > 0
                    ? await admin.from('organizations').select('id, org_name, states(state_name)').in('id', shopOrgIds)
                    : { data: [] as any[] };
                const shopNameById = new Map((shopOrgs || []).map((item: any) => [item.id, item.org_name]));
                const shopStateById = new Map((shopOrgs || []).map((item: any) => [item.id, item.states?.state_name || null]));

                for (let index = 0; index < userIds.length; index += 100) {
                    const userIdChunk = userIds.slice(index, index + 100);
                    if (userIdChunk.length === 0) continue;

                    const { data: scanRows, error: scanError } = await admin
                        .from('consumer_qr_scans')
                        .select('consumer_id, points_amount, scanned_at, points_collected_at')
                        .eq('collected_points', true)
                        .eq('claim_lane', 'shop')
                        .in('consumer_id', userIdChunk);

                    if (scanError) throw scanError;

                    for (const row of scanRows || []) {
                        const userId = row.consumer_id;
                        if (!userId) continue;
                        const current = statsByUser.get(userId) || { current_balance: 0, last_transaction_date: null, last_scan_at: null };
                        current.current_balance += Number(row.points_amount || 0);
                        if (!current.last_transaction_date || (row.points_collected_at && row.points_collected_at > current.last_transaction_date)) {
                            current.last_transaction_date = row.points_collected_at;
                        }
                        if (!current.last_scan_at || (row.scanned_at && row.scanned_at > current.last_scan_at)) {
                            current.last_scan_at = row.scanned_at;
                        }
                        statsByUser.set(userId, current);
                    }

                    const { data: transactionRows, error: transactionError } = await admin
                        .from('points_transactions')
                        .select('user_id, transaction_type, points_amount, transaction_date')
                        .in('user_id', userIdChunk);

                    if (transactionError) throw transactionError;

                    for (const row of transactionRows || []) {
                        const userId = row.user_id;
                        if (!userId) continue;
                        const current = statsByUser.get(userId) || { current_balance: 0, last_transaction_date: null, last_scan_at: null };
                        const amount = Number(row.points_amount || 0);
                        const type = row.transaction_type || '';

                        if (type !== 'adjust') {
                            current.current_balance += amount;
                        } else {
                            current.current_balance += amount;
                        }

                        if (!current.last_transaction_date || (row.transaction_date && row.transaction_date > current.last_transaction_date)) {
                            current.last_transaction_date = row.transaction_date;
                        }
                        statsByUser.set(userId, current);
                    }
                }

                for (const staff of shopUsers) {
                    const stats = statsByUser.get(staff.id) || { current_balance: 0, last_transaction_date: null, last_scan_at: null };
                    const recipient = {
                        id: staff.id,
                        user_id: staff.id,
                        name: staff.full_name || 'Unknown Shop Staff',
                        phone: staff.phone || 'No Phone',
                        state: shopStateById.get(staff.organization_id || '') || 'No Location',
                        city: shopStateById.get(staff.organization_id || '') || '',
                        organization_type: 'SHOP',
                        org_name: shopNameById.get(staff.organization_id || '') || 'Shop',
                    };
                    const isActive = isReportRowActive(stats.current_balance, stats.last_transaction_date, reportStatusSettings.shopStaffPerformance);
                    pushWinbackRecipient(recipient, isActive, stats.last_scan_at, stats.current_balance);
                }
            }

            if (activeFilters.winback_category === 'consumer_performance') {
                const { data: consumerScanRows, error: consumerScanError } = await admin
                    .from('consumer_qr_scans')
                    .select('consumer_id, scanned_at')
                    .eq('claim_lane', 'consumer')
                    .eq('collected_points', true);

                if (consumerScanError) throw consumerScanError;

                const consumerIds = new Set<string>();
                const lastScanByConsumerId = new Map<string, string>();
                for (const row of consumerScanRows || []) {
                    if (!row.consumer_id) continue;
                    consumerIds.add(row.consumer_id);
                    if (!lastScanByConsumerId.has(row.consumer_id) || (row.scanned_at && row.scanned_at > lastScanByConsumerId.get(row.consumer_id)!)) {
                        lastScanByConsumerId.set(row.consumer_id, row.scanned_at);
                    }
                }

                const { data: consumerRows, error: consumerRowsError } = await admin
                    .from('v_consumer_points_summary' as any)
                    .select('user_id, name, whatsapp_phone, whatsapp_valid, state, organization_id, current_balance, last_activity_at, is_active')
                    .eq('is_active', true)
                    .is('organization_id', null);

                if (consumerRowsError) throw consumerRowsError;

                for (const consumer of consumerRows || []) {
                    if (!consumerIds.has(consumer.user_id)) continue;
                    const recipient = {
                        id: consumer.user_id,
                        user_id: consumer.user_id,
                        name: consumer.name || 'Unknown',
                        phone: consumer.whatsapp_phone || 'No Phone',
                        state: consumer.state || 'No Location',
                        city: consumer.state || '',
                        organization_type: 'End User',
                        org_name: 'End User',
                        whatsapp_valid: consumer.whatsapp_valid,
                    };
                    const isActive = isReportRowActive(consumer.current_balance, consumer.last_activity_at, reportStatusSettings.consumerPerformance);
                    pushWinbackRecipient(recipient, isActive, lastScanByConsumerId.get(consumer.user_id), consumer.current_balance);
                }
            }
        }

        if (!isWinbackRequest) {

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

                            const userInfo = {
                                id: u.id,
                                user_id: u.id, // Include user_id for points balance lookup
                                name: u.full_name || 'Unknown',
                                phone: phone || 'No Phone',
                                state: stateName || 'No Location',
                                city: stateName || '', // Use state as city for token resolution
                                location: u.location || '',
                                organization_type: org?.org_type_code || 'Unknown',
                                org_name: org?.org_name || 'Unknown',
                                is_organization_user: true
                            };

                            totalMatched++;

                            // Check for valid phone
                            if (!phone || phone.length < 8) {
                                excludedMissingPhone++;
                                excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Missing/Invalid Phone' });
                                continue;
                            }

                            // Check opt-out
                            if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                                excludedOptOut++;
                                excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Opt-out' });
                                continue;
                            }

                            validPhones++;
                            eligibleRecipients.push({ ...userInfo, status: 'eligible' });
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

                    const orgInfo = {
                        id: org.id,
                        // Organizations don't have user_id - they're org contacts
                        name: org.contact_name || org.org_name,
                        phone: phone || 'No Phone',
                        state: stateName || 'No Location',
                        city: stateName || '', // Use state as city for token resolution
                        organization_type: org.org_type_code,
                        org_name: org.org_name,
                        is_organization: true
                    };

                    // Apply location filter
                    if (locationStates.length > 0 && stateName && !locationStates.includes(stateName)) {
                        continue; // Skip if location doesn't match
                    }

                    totalMatched++;

                    // Check for valid phone
                    if (!phone || phone.length < 8) {
                        excludedMissingPhone++;
                        excludedRecipients.push({ ...orgInfo, status: 'excluded', exclusion_reason: 'Missing/Invalid Phone' });
                        continue;
                    }

                    // Check opt-out
                    if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                        excludedOptOut++;
                        excludedRecipients.push({ ...orgInfo, status: 'excluded', exclusion_reason: 'Opt-out' });
                        continue;
                    }

                    validPhones++;
                    eligibleRecipients.push({ ...orgInfo, status: 'eligible' });
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
                const userInfo = {
                    id: u.user_id,
                    user_id: u.user_id, // Include user_id for points balance lookup
                    name: u.name || 'Unknown',
                    phone: phone || 'No Phone',
                    state: u.state || 'No Location',
                    city: u.state || '', // Use state as city for token resolution
                    location: u.state || '',
                    organization_type: 'End User',
                    org_name: 'End User',
                    current_balance: u.current_balance,
                    collected_system: u.collected_system
                };

                totalMatched++;

                // Check for valid phone
                if (!phone || phone.length < 8) {
                    excludedMissingPhone++;
                    excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Missing Phone' });
                    continue;
                }

                // Check valid WhatsApp
                if (activeFilters.only_valid_whatsapp !== false && !u.whatsapp_valid) {
                    excludedInvalidWA++;
                    excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Invalid WhatsApp' });
                    continue;
                }

                // Check opt-out
                if (activeFilters.opt_in_only !== false && optOutPhones.has(phone)) {
                    excludedOptOut++;
                    excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Opt-out' });
                    continue;
                }

                // Activity Filters for End Users
                if (needsActivationData) {
                    const hasScanned = activatedUserIds.has(u.user_id);

                    if (activeFilters.never_login === true && hasScanned) {
                        excludedActivity++;
                        excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Activity (Logged in)' });
                        continue;
                    }

                    if (activeFilters.never_scanned === true) {
                        if (hasScanned || u.collected_system > 0) {
                            excludedActivity++;
                            excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Activity (Scanned)' });
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
                                excludedRecipients.push({ ...userInfo, status: 'excluded', exclusion_reason: 'Activity (Recent)' });
                                continue;
                            }
                        }
                    }
                }

                validPhones++;
                eligibleRecipients.push({ ...userInfo, status: 'eligible' });
            }
        }

        }

        // Apply manual overrides (exclude_ids and include_ids)
        let excludedByOverride = 0;

        // Move manually excluded users from eligible to excluded
        if (excludeIds.size > 0) {
            const manuallyExcluded = eligibleRecipients.filter(u => excludeIds.has(u.id));
            eligibleRecipients = eligibleRecipients.filter(u => !excludeIds.has(u.id));

            manuallyExcluded.forEach(u => {
                excludedRecipients.unshift({ ...u, status: 'excluded', exclusion_reason: 'Manually Excluded' });
                excludedByOverride++;
            });

            validPhones -= manuallyExcluded.length;
        }

        // Move manually included users from excluded to eligible (if they have valid phone)
        if (includeIds.size > 0) {
            const manuallyIncluded = excludedRecipients.filter(u =>
                includeIds.has(u.id) && u.phone && u.phone.trim() !== ''
            );
            excludedRecipients = excludedRecipients.filter(u => !includeIds.has(u.id));

            manuallyIncluded.forEach(u => {
                eligibleRecipients.push({ ...u, status: 'eligible', exclusion_reason: undefined });
            });

            validPhones += manuallyIncluded.length;
        }

        const offset = typeof body.offset === 'number' ? body.offset : 0;
        const limit = typeof body.limit === 'number' ? body.limit : 20;
        const view = body.view || 'eligible';

        return NextResponse.json({
            total_all_users: totalAllUsers || 0,
            total_matched: totalMatched,
            eligible_count: validPhones,
            excluded_missing_phone: excludedMissingPhone,
            excluded_opt_out: excludedOptOut,
            excluded_invalid_wa: excludedInvalidWA,
            excluded_activity: excludedActivity,
            excluded_by_override: excludedByOverride,
            excluded_total: excludedMissingPhone + excludedOptOut + excludedInvalidWA + excludedActivity + excludedByOverride,
            preview: view === 'eligible' ? eligibleRecipients.slice(offset, offset + limit) : [],
            excluded_list: view === 'excluded' ? excludedRecipients.slice(offset, offset + limit) : [],
            users: body.include_all ? eligibleRecipients : undefined
        });

    } catch (err: any) {
        console.error('Audience resolve error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
