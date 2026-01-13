import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  
  // Create a TransformStream for streaming response
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  
  const sendProgress = async (data: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // Start processing in background
  ;(async () => {
    try {
      const supabaseAdmin = getAdminClient()
      const supabase = await createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        await sendProgress({ type: 'error', error: 'Unauthorized' })
        await writer.close()
        return
      }

      // Check admin role
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role_code')
        .eq('id', user.id)
        .single()
        
      if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
        await sendProgress({ type: 'error', error: 'Forbidden' })
        await writer.close()
        return
      }

      const body = await request.json()
      const { subject, message, attachments, targetType, states, roles } = body

      if (!message) {
        await sendProgress({ type: 'error', error: 'Message is required' })
        await writer.close()
        return
      }

      await sendProgress({ type: 'status', message: 'Fetching target users...' })

      // Helper function to fetch all users with pagination (Supabase default limit is 1000)
      const fetchAllUsers = async (query: any): Promise<string[]> => {
        const PAGE_SIZE = 1000
        let allIds: string[] = []
        let offset = 0
        let hasMore = true
        
        while (hasMore) {
          const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
          if (error) {
            console.error('Error fetching users:', error)
            throw error
          }
          if (data && data.length > 0) {
            allIds = [...allIds, ...data.map((u: any) => u.id)]
            offset += PAGE_SIZE
            hasMore = data.length === PAGE_SIZE
          } else {
            hasMore = false
          }
        }
        return allIds
      }

      // Get target users based on filters
      let targetUserIds: string[] = []
      
      if (targetType === 'all' || !targetType) {
        try {
          const query = supabaseAdmin
            .from('users')
            .select('id')
            .not('email', 'is', null)
          
          targetUserIds = await fetchAllUsers(query)
        } catch (error) {
          await sendProgress({ type: 'error', error: 'Failed to fetch users' })
          await writer.close()
          return
        }
      } else if (targetType === 'state' && states && states.length > 0) {
        const { data: orgs, error: orgsError } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .in('state', states)

        if (!orgsError && orgs && orgs.length > 0) {
          const orgIds = orgs.map(o => o.id)
          try {
            const query = supabaseAdmin
              .from('users')
              .select('id')
              .in('company_id', orgIds)
              .not('email', 'is', null)
            
            targetUserIds = await fetchAllUsers(query)
          } catch (error) {
            await sendProgress({ type: 'error', error: 'Failed to fetch users' })
            await writer.close()
            return
          }
        }
      } else if (targetType === 'role' && roles && roles.length > 0) {
        const roleMapping: Record<string, string[]> = {
          'consumer': ['consumer', 'CONSUMER'],
          'shop': ['shop', 'SHOP', 'shop_owner'],
          'SA': ['SA', 'SALES_AGENT'],
          'HQ': ['HQ', 'HQ_ADMIN', 'POWER_USER', 'admin', 'super_admin']
        }
        
        const actualRoles = roles.flatMap((r: string) => roleMapping[r] || [r])
        
        try {
          const query = supabaseAdmin
            .from('users')
            .select('id')
            .in('role_code', actualRoles)
            .not('email', 'is', null)
          
          targetUserIds = await fetchAllUsers(query)
        } catch (error) {
          await sendProgress({ type: 'error', error: 'Failed to fetch users' })
          await writer.close()
          return
        }
      }

      if (targetUserIds.length === 0) {
        await sendProgress({ type: 'error', error: 'No users found matching criteria' })
        await writer.close()
        return
      }

      const totalUsers = targetUserIds.length
      await sendProgress({ 
        type: 'start', 
        total: totalUsers,
        message: `Starting blast to ${totalUsers} users...`
      })

      // Process in batches of 50
      const BATCH_SIZE = 50
      let sentCount = 0
      let failedCount = 0
      const errors: string[] = []
      
      for (let i = 0; i < targetUserIds.length; i += BATCH_SIZE) {
        const batch = targetUserIds.slice(i, i + BATCH_SIZE)
        const batchPromises = batch.map(async (userId) => {
          try {
            // Check if user already has an Announcement thread
            const { data: existingThread } = await supabaseAdmin
              .from('support_threads')
              .select('id')
              .eq('created_by_user_id', userId)
              .eq('subject', 'Announcements')
              .is('user_deleted_at', null)
              .single()

            let threadId: string

            if (existingThread) {
              threadId = existingThread.id
              await supabaseAdmin
                .from('support_threads')
                .update({
                  last_message_at: new Date().toISOString(),
                  last_message_preview: message.substring(0, 50),
                  status: 'open'
                })
                .eq('id', threadId)
            } else {
              const { data: newThread, error: threadError } = await supabaseAdmin
                .from('support_threads')
                .insert({
                  created_by_user_id: userId,
                  subject: 'Announcements',
                  status: 'open',
                  last_message_at: new Date().toISOString(),
                  last_message_preview: message.substring(0, 50)
                })
                .select('id')
                .single()

              if (threadError || !newThread) {
                throw new Error(`Thread creation failed: ${threadError?.message}`)
              }
              threadId = newThread.id
            }

            const { error: messageError } = await supabaseAdmin
              .from('support_messages')
              .insert({
                thread_id: threadId,
                sender_type: 'admin',
                sender_user_id: user.id,
                body: message,
                attachments: attachments || []
              })

            if (messageError) {
              throw new Error(`Message insert failed: ${messageError.message}`)
            }

            return { success: true }
          } catch (err: any) {
            return { success: false, error: err.message }
          }
        })

        const results = await Promise.all(batchPromises)
        
        for (const result of results) {
          if (result.success) {
            sentCount++
          } else {
            failedCount++
            if (errors.length < 5) {
              errors.push(result.error || 'Unknown error')
            }
          }
        }

        // Send progress update
        const progress = Math.round(((i + batch.length) / totalUsers) * 100)
        await sendProgress({
          type: 'progress',
          sent: sentCount,
          failed: failedCount,
          total: totalUsers,
          progress,
          message: `Processing... ${sentCount} sent, ${failedCount} failed`
        })
      }

      // Final update
      await sendProgress({
        type: 'complete',
        sent: sentCount,
        failed: failedCount,
        total: totalUsers,
        errors: errors.length > 0 ? errors : undefined,
        message: `Blast completed! ${sentCount} sent, ${failedCount} failed`
      })
      
      await writer.close()
    } catch (error: any) {
      console.error('Blast stream error:', error)
      await sendProgress({ type: 'error', error: error.message || 'Internal Server Error' })
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
