import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

// Note: short_links and consumer_points_summary tables are accessed here. TypeScript types will be generated after migration.

// Normalize phone number to E.164 format for Malaysian/Chinese numbers
function normalizePhone(phone: string): string {
    if (!phone) return '';
    // Remove all non-digit characters except leading +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // If starts with +, assume already has country code
    if (cleaned.startsWith('+')) {
        return cleaned;
    }

    // Malaysian number: starts with 0, convert to +60
    if (cleaned.startsWith('0')) {
        return '+6' + cleaned; // 0192277233 -> +60192277233
    }

    // Chinese number: starts with 1 and is 11 digits
    if (cleaned.startsWith('1') && cleaned.length === 11) {
        return '+86' + cleaned;
    }

    // If starts with 60 (Malaysia without +)
    if (cleaned.startsWith('60') && cleaned.length >= 11) {
        return '+' + cleaned;
    }

    // If starts with 86 (China without +)
    if (cleaned.startsWith('86') && cleaned.length >= 13) {
        return '+' + cleaned;
    }

    return cleaned;
}

// POST: Preview message with resolved tokens
export async function POST(request: Request) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated

    // Use admin client for user lookups to bypass RLS
    let supabaseAdmin: any;
    try {
        supabaseAdmin = createAdminClient();
    } catch (err) {
        console.error('[Preview API] Failed to create admin client:', err);
        supabaseAdmin = supabase; // Fallback to regular client
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin access
    const { data: userProfile } = await supabase
        .from('users')
        .select('organization_id, role_code, roles!inner(role_level)')
        .eq('id', user.id)
        .single();

    const roleLevel = (userProfile?.roles as any)?.role_level || 100;
    if (roleLevel > 20) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { message_template, test_user_id, test_phone } = body;

        if (!message_template) {
            return NextResponse.json({ error: 'Message template is required' }, { status: 400 });
        }

        // Find test user (use admin client to bypass RLS)
        let testUser = null;
        if (test_user_id) {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, full_name, phone, location, organization_id')
                .eq('id', test_user_id)
                .maybeSingle();
            testUser = data;
        } else if (test_phone) {
            // Normalize the phone number to match DB format
            const normalizedPhone = normalizePhone(test_phone);
            console.log('[Preview API] Searching for phone:', test_phone, '-> normalized:', normalizedPhone);

            // Try exact match first with normalized phone
            let { data, error } = await supabaseAdmin
                .from('users')
                .select('id, full_name, phone, location, organization_id')
                .eq('phone', normalizedPhone)
                .maybeSingle();

            console.log('[Preview API] Exact match result:', data, 'error:', error?.message);

            // If not found, try original input
            if (!data) {
                const result = await supabaseAdmin
                    .from('users')
                    .select('id, full_name, phone, location, organization_id')
                    .eq('phone', test_phone)
                    .maybeSingle();
                data = result.data;
                console.log('[Preview API] Original input match result:', result.data, 'error:', result.error?.message);
            }

            // If still not found, try ilike search for partial match
            if (!data) {
                const searchPattern = test_phone.replace(/^0/, '').replace(/^\+/, '');
                console.log('[Preview API] Trying ilike with pattern:', searchPattern);
                const result = await supabaseAdmin
                    .from('users')
                    .select('id, full_name, phone, location, organization_id')
                    .ilike('phone', `%${searchPattern}%`)
                    .limit(1)
                    .maybeSingle();
                data = result.data;
                console.log('[Preview API] ilike match result:', result.data, 'error:', result.error?.message);
            }

            testUser = data;
        }

        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
        const appUrl = appBaseUrl ? `${appBaseUrl}/app` : '';

        // Get points balance if we have a test user
        let pointsBalance = '0';
        if (testUser?.id) {
            // Try to get points balance from the consumer points balance view
            const { data: pointsData } = await supabase
                .from('v_consumer_points_balance')
                .select('current_balance')
                .eq('user_id', testUser.id)
                .single();

            if (pointsData?.current_balance !== undefined && pointsData?.current_balance !== null) {
                pointsBalance = Number(pointsData.current_balance || 0).toLocaleString();
            }
        }

        const isResolvedValue = (value: string | null | undefined) => value !== null && value !== undefined && value !== '';

        const nameValue = testUser?.full_name || 'Customer';
        const nameUsedFallback = !testUser?.full_name;
        const nameResolved = isResolvedValue(nameValue);

        const cityValue = testUser?.location || '';
        const cityResolved = isResolvedValue(cityValue);

        const shortLinkValue = appUrl || '';
        const shortLinkResolved = isResolvedValue(shortLinkValue);

        // Define token resolutions
        const tokenResolutions: Record<string, { value: string; resolved: boolean; usedFallback?: boolean; missingReason?: string; replacementValue?: string }> = {
            '{name}': {
                value: nameValue,
                resolved: nameResolved,
                usedFallback: nameUsedFallback && nameResolved
            },
            '{city}': {
                value: cityValue,
                resolved: cityResolved,
                missingReason: cityResolved ? undefined : 'No data'
            },
            '{points_balance}': {
                value: pointsBalance,
                resolved: isResolvedValue(pointsBalance)
            },
            '{short_link}': {
                value: shortLinkValue,
                resolved: shortLinkResolved,
                missingReason: shortLinkResolved ? undefined : 'App URL not configured',
                replacementValue: shortLinkResolved ? shortLinkValue : '{short_link}'
            }
        };

        // Resolve message
        let resolvedMessage = message_template;
        const missingTokens: string[] = [];
        const tokenDebug: Record<string, { value: string; resolved: boolean; usedFallback?: boolean; missingReason?: string }> = {};

        // Find all tokens in the message
        const tokenPattern = /\{([a-zA-Z0-9_-]+)\}/g;
        const foundTokens = new Set<string>();
        let match;
        while ((match = tokenPattern.exec(message_template)) !== null) {
            foundTokens.add(match[0]);
        }

        // Resolve known tokens
        for (const token of foundTokens) {
            const resolution = tokenResolutions[token];
            if (resolution) {
                const replaceValue = resolution.replacementValue ?? resolution.value;
                resolvedMessage = resolvedMessage.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'g'), replaceValue);
                tokenDebug[token] = {
                    value: resolution.value,
                    resolved: resolution.resolved,
                    usedFallback: resolution.usedFallback,
                    missingReason: resolution.missingReason
                };
                if (!resolution.resolved) {
                    missingTokens.push(token);
                }
            } else {
                // Unknown token
                missingTokens.push(token);
                tokenDebug[token] = {
                    value: '',
                    resolved: false,
                    missingReason: 'Unknown token'
                };
            }
        }

        return NextResponse.json({
            resolved_message: resolvedMessage,
            missing_tokens: missingTokens,
            token_debug: tokenDebug,
            test_user: testUser ? {
                id: testUser.id,
                full_name: testUser.full_name,
                phone: testUser.phone
            } : null,
            user_found: !!testUser,
            search_input: test_phone || test_user_id || null
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
