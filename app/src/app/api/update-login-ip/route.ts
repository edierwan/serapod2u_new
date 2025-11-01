import { NextRequest, NextResponse } from 'next/server'
import { isIP } from 'node:net'
import { createClient } from '@/lib/supabase/server'

/**
 * API Route to update user's last login IP
 * Called after successful login to capture the client's IP address
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Extract IP from headers (in order of reliability)
    const forwarded = request.headers.get('x-forwarded-for')
    const real = request.headers.get('x-real-ip')
    const cfConnecting = request.headers.get('cf-connecting-ip') // Cloudflare
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for')

    let clientIp: string | null = null

    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, take the first one (client IP)
      clientIp = forwarded.split(',')[0].trim()
    } else if (real) {
      clientIp = real
    } else if (cfConnecting) {
      clientIp = cfConnecting
    } else {
      // Fallback options
      clientIp = vercelForwarded
    }

    const normalizeIp = (input: string | null) => {
      if (!input) {
        return { stored: null as string | null, display: null as string | null }
      }

      let value = input.trim()
      if (!value) {
        return { stored: null, display: null }
      }

      // Remove any appended metadata e.g. "127.0.0.1 (localhost)"
      if (value.includes(' ')) {
        value = value.split(' ')[0]
      }

      // Drop IPv6 zone identifiers (e.g. fe80::1%lo0)
      if (value.includes('%')) {
        value = value.split('%')[0]
      }

      // Handle IPv4-mapped IPv6 notation
      if (value.startsWith('::ffff:')) {
        value = value.substring(7)
      }

      // Map common localhost representations to IPv4 loopback
      if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value.toLowerCase() === 'localhost') {
        value = '127.0.0.1'
      }

      if (!isIP(value)) {
        return {
          stored: null,
          display: input.trim() || 'Unknown'
        }
      }

      const display = value === '127.0.0.1' ? '127.0.0.1 (localhost)' : value

      return {
        stored: value,
        display
      }
    }

    const { stored: normalizedIp, display: friendlyIp } = normalizeIp(clientIp)
    
    // Update user's last_login_ip in users table
    const { data: updateData, error: updateError } = await supabase
      .from('users')
      .update({ 
        last_login_ip: normalizedIp,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select()
    
    if (updateError) {
      console.error('Failed to update last_login_ip:', updateError.message, updateError.details)
      
      // Check if it's an RLS policy issue
      if (updateError.code === '42501' || updateError.message.includes('policy')) {
        console.warn('RLS policy prevents update - user may need update permissions')
        // Return success anyway since this is not critical
        return NextResponse.json({ 
          success: true, 
          ip: clientIp, 
          warning: 'IP captured but not stored due to permissions' 
        })
      }
      
      return NextResponse.json({ 
        error: 'Failed to update IP', 
        details: updateError.message,
        rawIp: clientIp,
        normalizedIp
      }, { status: 500 })
    }
    
    return NextResponse.json({ 
      success: true, 
      ip: normalizedIp,
      displayIp: friendlyIp ?? normalizedIp,
      rawIp: clientIp,
      updated: updateData && updateData.length > 0 
    })
  } catch (error) {
    console.error('Error in update-login-ip:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
