
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { phone, message } = await req.json();

        if (!phone || !message) {
            return NextResponse.json({ error: 'Phone and message required' }, { status: 400 });
        }

        // In a real implementation, we would call the Baileys Gateway API here.
        // For this demo/task, we will mock the successful "send" and return success.

        // Mock Gateway Call
        console.log(`[Marketing Mock Send] Sending to ${phone}: ${message}`);

        // Simulate delay
        await new Promise(r => setTimeout(r, 1000));

        return NextResponse.json({ success: true, status: 'sent', providerId: 'mock-id-123' });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
