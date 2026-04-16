import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

export const dynamic = 'force-dynamic'

function getPhoneVariants(phone: string): string[] {
  const normalized = normalizePhoneE164(phone)
  if (!normalized) return []

  const providerPhone = toProviderPhone(normalized)
  const variants = [normalized]
  if (providerPhone) {
    variants.push(providerPhone)
    if (providerPhone.startsWith('60')) {
      variants.push(`0${providerPhone.slice(2)}`)
    }
  }

  return [...new Set(variants.filter(Boolean))]
}

/**
 * POST /api/user/lookup-phone
 * Lookup a user's name by their phone number (for referral checks)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phone, email, query } = body

    const rawQuery = (query || phone || email || '').toString().trim()

    if (!rawQuery) {
      return NextResponse.json(
        { success: false, error: 'Phone number or email is required' },
        { status: 400 }
      )
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Service role client to bypass RLS
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const isEmail = rawQuery.includes('@')

    if (isEmail) {
      // Email lookup - exact match
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('email', rawQuery)
        .single()

      if (error || !user) {
        return NextResponse.json({
          success: false,
          message: 'User not found'
        })
      }

      return NextResponse.json({
        success: true,
        name: user.full_name,
        matched_by: 'email'
      })
    } else {
      const phoneVariants = getPhoneVariants(rawQuery)
      if (!phoneVariants.length) {
        return NextResponse.json({ success: false, message: 'User not found' })
      }

      // Query with OR condition for all variants
      const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('full_name, phone')
        .in('phone', phoneVariants)
        .limit(1)

      if (error || !users || users.length === 0) {
        return NextResponse.json({
          success: false,
          message: 'User not found'
        })
      }

      return NextResponse.json({
        success: true,
        name: users[0].full_name,
        matched_by: 'phone'
      })
    }

  } catch (error) {
    console.error('Error looking up phone:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
