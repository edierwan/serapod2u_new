import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
    try {
        const { userId, phone } = await request.json()

        if (!userId || !phone) {
            return NextResponse.json(
                { success: false, error: 'Missing userId or phone' },
                { status: 400 }
            )
        }

        const supabase = await createClient()

        // Update phone in public.users table
        const { error } = await supabase
            .from('users')
            .update({ phone })
            .eq('id', userId)

        if (error) {
            console.error('Error updating phone in public.users:', error)
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Error in update-phone API:', error)
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
