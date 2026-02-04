import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Note: message_variables table is created by migration. TypeScript types will be generated after migration.

// GET: List all message variables (tokens)
export async function GET(request: Request) {
    const supabase = await createClient() as any; // Cast to any until types are regenerated

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try to get from database first
    const { data: dbVariables, error: dbError } = await supabase
        .from('message_variables')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    const defaultVariables = [
        {
            token: '{name}',
            description: "User's full name",
            source: 'users.full_name',
            fallback: 'Customer',
            example: 'John Doe'
        },
        {
            token: '{city}',
            description: "User's city location",
            source: 'users.city',
            fallback: '',
            example: 'Kuala Lumpur'
        },
        {
            token: '{points_balance}',
            description: "User's current loyalty points balance",
            source: 'computed',
            fallback: '0',
            example: '1,250'
        },
        {
            token: '{short_link}',
            description: 'App link (opens the consumer app)',
            source: 'app_url',
            fallback: '',
            example: 'https://serapod2u.com/app'
        }
    ];

    const deprecatedTokens = new Set(['{page_rewards}', '{page_product}', '{page-contactus}', '{External_URL}']);

    // If database has variables, merge and ensure required tokens exist
    if (!dbError && dbVariables && dbVariables.length > 0) {
        const merged = new Map<string, any>();
        for (const v of dbVariables) {
            if (!deprecatedTokens.has(v.token)) {
                merged.set(v.token, v);
            }
        }
        for (const v of defaultVariables) {
            if (!merged.has(v.token)) {
                merged.set(v.token, v);
            }
        }
        return NextResponse.json(Array.from(merged.values()));
    }

    // Fallback to hardcoded variables if table doesn't exist or is empty
    return NextResponse.json(defaultVariables);
}
