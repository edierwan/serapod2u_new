import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data } = await supabase
            .from('users')
            .select('location')
            .not('location', 'is', null)
            .neq('location', '');

        // Get unique, non-empty locations, sorted A-Z
        const uniqueLocations = Array.from(new Set(
            data?.map(d => d.location?.trim()).filter(l => l)
        )).sort();

        return NextResponse.json({ states: uniqueLocations });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
