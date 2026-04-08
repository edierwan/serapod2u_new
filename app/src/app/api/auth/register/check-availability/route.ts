import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import { checkRegistrationAvailability } from '@/server/auth/registrationVerificationService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const email = String(body?.email || '').trim().toLowerCase()
        const phoneRaw = String(body?.phone || '').trim()

        if (!email && !phoneRaw) {
            return NextResponse.json({ error: 'Email or phone is required.' }, { status: 400 })
        }

        const admin = createAdminClient()

        let emailAvailable = true
        let phoneAvailable = true
        let normalizedPhone = ''

        if (email && phoneRaw) {
            const result = await checkRegistrationAvailability(admin, email, phoneRaw)
            emailAvailable = result.emailAvailable
            phoneAvailable = result.phoneAvailable
            normalizedPhone = result.normalizedPhone
        } else if (email) {
            const { data, error } = await admin
                .from('users')
                .select('id')
                .ilike('email', email)
                .limit(1)

            if (error) throw error
            emailAvailable = !data || data.length === 0
        } else if (phoneRaw) {
            normalizedPhone = normalizePhoneE164(phoneRaw)
            const { data, error } = await (admin as any).rpc('check_phone_exists', {
                p_phone: normalizedPhone,
                p_exclude_user_id: null,
            })
            if (error) throw error
            phoneAvailable = !data
        }

        return NextResponse.json({
            success: true,
            email: {
                available: emailAvailable,
                message: email
                    ? emailAvailable
                        ? 'This email address is available for registration.'
                        : 'This email address is already linked to an existing account. Please sign in or use a different email.'
                    : null,
            },
            phone: {
                available: phoneAvailable,
                normalized: normalizedPhone || null,
                message: phoneRaw
                    ? phoneAvailable
                        ? 'This mobile number is available for registration.'
                        : 'This mobile number is already linked to an existing account. Please sign in or use a different number.'
                    : null,
            },
        })
    } catch (error: any) {
        console.error('Registration availability check error:', error)
        return NextResponse.json(
            { error: 'Unable to validate registration details at the moment. Please try again.' },
            { status: 500 },
        )
    }
}
