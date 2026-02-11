import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET  /api/hr/employees/profile?user_id=xxx  ── fetch HR profile
// ─── PUT  /api/hr/employees/profile               ── upsert HR profile
// ─── POST /api/hr/employees/profile/link           ── link existing user to HR

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: caller } = await supabase
            .from('users')
            .select('organization_id, role_code')
            .eq('id', user.id)
            .single()

        if (!caller?.organization_id) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        // Resolve role level
        let roleLevel = 99
        if (caller.role_code) {
            const { data: roleData } = await supabase.from('roles').select('role_level').eq('role_code', caller.role_code).maybeSingle()
            if (roleData) roleLevel = roleData.role_level
        }

        const url = new URL(request.url)
        const userId = url.searchParams.get('user_id')

        if (!userId) {
            return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 })
        }

        // Check permission: own profile or manager
        if (userId !== user.id && roleLevel > 20) {
            return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
        }

        const { data: profile, error } = await supabase
            .from('hr_employee_profiles')
            .select('*')
            .eq('user_id', userId)
            .eq('organization_id', caller.organization_id)
            .maybeSingle()

        // If table doesn't exist yet (migration not run), gracefully return null
        if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) {
            // table not yet created — continue with null profile
        } else if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        // Also fetch the user's basic info + hr_employees data
        const { data: userInfo, error: userError } = await supabase
            .from('users')
            .select(`
                id, full_name, email, phone, avatar_url, role_code, is_active,
                department_id, manager_user_id, position_id, employee_no,
                employment_type, employment_status, join_date
            `)
            .eq('id', userId)
            .single()

        if (userError) {
            return NextResponse.json({ success: false, error: 'User not found: ' + userError.message }, { status: 404 })
        }

        const { data: hrEmployee } = await supabase
            .from('hr_employees')
            .select('employee_no, hire_date, probation_end, status, notes')
            .eq('user_id', userId)
            .eq('organization_id', caller.organization_id)
            .maybeSingle()

        return NextResponse.json({
            success: true,
            data: {
                user: userInfo,
                hr_employee: hrEmployee,
                profile: profile || null,
            },
        })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

export async function PUT(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: caller } = await supabase
            .from('users')
            .select('organization_id, role_code')
            .eq('id', user.id)
            .single()

        if (!caller?.organization_id) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        // Resolve role level
        let roleLevel = 99
        if (caller.role_code) {
            const { data: roleData } = await supabase.from('roles').select('role_level').eq('role_code', caller.role_code).maybeSingle()
            if (roleData) roleLevel = roleData.role_level
        }

        const body = await request.json()
        const { user_id, ...profileFields } = body

        if (!user_id) {
            return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 })
        }

        // Only managers can edit other profiles, employees can edit their own limited fields
        const isManager = roleLevel <= 20
        const isSelf = user_id === user.id

        if (!isManager && !isSelf) {
            return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
        }

        // Self-service: limit editable fields
        const allowedSelfFields = [
            'personal_email', 'personal_phone', 'address_line1', 'address_line2',
            'city', 'state', 'postcode', 'country',
            'emergency_name', 'emergency_relationship', 'emergency_phone', 'emergency_address',
            'bank_name', 'bank_account_no', 'bank_holder_name',
        ]

        const sanitized: Record<string, any> = {}
        for (const [key, value] of Object.entries(profileFields)) {
            if (isManager || allowedSelfFields.includes(key)) {
                sanitized[key] = value
            }
        }

        // Upsert profile
        const { data, error } = await supabase
            .from('hr_employee_profiles')
            .upsert({
                user_id,
                organization_id: caller.organization_id,
                ...sanitized,
            }, { onConflict: 'user_id,organization_id' })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    // Link existing user from User Management to HR module
    try {
        const supabase = (await createClient()) as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: callerPost } = await supabase
            .from('users')
            .select('organization_id, role_code')
            .eq('id', user.id)
            .single()

        if (!callerPost?.organization_id) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        // Resolve role level
        let postRoleLevel = 99
        if (callerPost.role_code) {
            const { data: rd } = await supabase.from('roles').select('role_level').eq('role_code', callerPost.role_code).maybeSingle()
            if (rd) postRoleLevel = rd.role_level
        }
        if (postRoleLevel > 20) {
            return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
        }

        const body = await request.json()
        const { user_ids, department_id, position_id, manager_user_id, employment_type } = body

        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return NextResponse.json({ success: false, error: 'user_ids array required' }, { status: 400 })
        }

        // Verify all users belong to the same org
        const { data: existingUsers, error: fetchError } = await supabase
            .from('users')
            .select('id, full_name, employee_no')
            .eq('organization_id', callerPost.organization_id)
            .in('id', user_ids)

        if (fetchError) {
            return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
        }

        if (!existingUsers || existingUsers.length === 0) {
            return NextResponse.json({ success: false, error: 'No matching users found in your organization' }, { status: 404 })
        }

        const results: { userId: string; name: string; employee_no: number | null; status: string }[] = []

        for (const u of existingUsers) {
            // Create hr_employees record if it doesn't exist
            const { data: existing } = await supabase
                .from('hr_employees')
                .select('id, employee_no')
                .eq('user_id', u.id)
                .eq('organization_id', callerPost.organization_id)
                .maybeSingle()

            let empNo = existing?.employee_no || u.employee_no

            if (!existing) {
                const { data: newHrEmp, error: insertErr } = await supabase
                    .from('hr_employees')
                    .insert({
                        user_id: u.id,
                        organization_id: callerPost.organization_id,
                        hire_date: new Date().toISOString().split('T')[0],
                        status: 'active',
                    })
                    .select('employee_no')
                    .single()

                if (insertErr) {
                    results.push({ userId: u.id, name: u.full_name, employee_no: null, status: `error: ${insertErr.message}` })
                    continue
                }
                empNo = newHrEmp.employee_no

                // Backfill employee_no to users table
                await supabase
                    .from('users')
                    .update({ employee_no: empNo })
                    .eq('id', u.id)
            }

            // Update HR fields if provided
            const hrUpdates: Record<string, any> = {}
            if (department_id) hrUpdates.department_id = department_id
            if (position_id) hrUpdates.position_id = position_id
            if (manager_user_id) hrUpdates.manager_user_id = manager_user_id
            if (employment_type) hrUpdates.employment_type = employment_type

            if (Object.keys(hrUpdates).length > 0) {
                await supabase.from('users').update(hrUpdates).eq('id', u.id)
            }

            // Auto-create profile
            await supabase
                .from('hr_employee_profiles')
                .upsert({
                    user_id: u.id,
                    organization_id: callerPost.organization_id,
                }, { onConflict: 'user_id,organization_id' })

            results.push({ userId: u.id, name: u.full_name, employee_no: empNo, status: 'linked' })
        }

        return NextResponse.json({
            success: true,
            data: results,
            linked: results.filter(r => r.status === 'linked').length,
            errors: results.filter(r => r.status.startsWith('error')).length,
        })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}
