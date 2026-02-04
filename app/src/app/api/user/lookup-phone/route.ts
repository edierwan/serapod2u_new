import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Normalize phone number to try multiple formats for lookup
 * Returns an array of possible phone formats to search for
 */
function getPhoneVariants(phone: string): string[] {
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  const variants: string[] = [];
  
  // If starts with 0 (local format like 0123191746)
  if (digitsOnly.startsWith('0')) {
    const withoutLeadingZero = digitsOnly.substring(1);
    variants.push(
      digitsOnly,                     // 0123191746
      `60${withoutLeadingZero}`,      // 60123191746
      `+60${withoutLeadingZero}`,     // +60123191746
    );
  }
  // If starts with 60 (country code format)
  else if (digitsOnly.startsWith('60')) {
    const withoutCountryCode = digitsOnly.substring(2);
    variants.push(
      digitsOnly,                     // 60123191746
      `+${digitsOnly}`,               // +60123191746
      `0${withoutCountryCode}`,       // 0123191746
    );
  }
  // If starts with + (already has plus)
  else if (phone.startsWith('+')) {
    const withoutPlus = digitsOnly;
    variants.push(
      phone,                          // +60123191746 (original)
      withoutPlus,                    // 60123191746
    );
    if (withoutPlus.startsWith('60')) {
      variants.push(`0${withoutPlus.substring(2)}`); // 0123191746
    }
  }
  // Just digits, assume needs 60 prefix
  else {
    variants.push(
      digitsOnly,                     // 123191746
      `60${digitsOnly}`,              // 60123191746
      `+60${digitsOnly}`,             // +60123191746
      `0${digitsOnly}`,               // 0123191746
    );
  }
  
  // Remove duplicates
  return [...new Set(variants)];
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
      // Phone lookup - try multiple format variants
      const phoneVariants = getPhoneVariants(rawQuery);
      
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
