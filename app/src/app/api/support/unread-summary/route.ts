import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Keep this endpoint simple and fast
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Use RPC if available for performance
        const { data: rpcCount, error: rpcError } = await supabase.rpc('get_user_support_unread_count')

        if (rpcError) {
            // Fallback: direct query
            const { data: conversations, error } = await supabase
                .from('support_conversations')
                .select('user_unread_count')
                .eq('created_by_user_id', user.id)
                .is('user_deleted_at', null)

            if (error) {
                console.error('Error fetching unread summary:', error)
                return NextResponse.json({ error: 'Failed to fetch unread count' }, { status: 500 })
            }

            const totalUnread = conversations?.reduce((sum, c) => sum + (c.user_unread_count || 0), 0) || 0
            const conversationsUnread = conversations?.filter(c => (c.user_unread_count || 0) > 0).length || 0
            
            return NextResponse.json({
                total_unread: totalUnread,
                conversations_unread: conversationsUnread
            })
        }

        // If RPC is successful, we might not get conversations_unread without another query or RPC update.
        // For now, let's just return total_unread as that's the critical part for the badge.
        // If the user REALLY needs conversations_unread, we can do a quick count query.
        
        const { count: conversationsUnread } = await supabase
            .from('support_conversations')
            .select('*', { count: 'exact', head: true })
            .eq('created_by_user_id', user.id)
            .gt('user_unread_count', 0)
            .is('user_deleted_at', null)

        return NextResponse.json({
            total_unread: rpcCount || 0,
            conversations_unread: conversationsUnread || 0
        })

    } catch (error) {
        console.error('Unexpected error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
