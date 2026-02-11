import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/utils'

// ─── POST /api/hr/employees  ── Create a new employee record
// ─── GET  /api/hr/employees  ── List employees, org-scoped

export async function GET(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Get caller's org
        const { data: caller } = await supabase
            .from('users')
            .select('organization_id, roles:role_code(role_level)')
            .eq('id', user.id)
            .single()

        if (!caller?.organization_id) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const url = new URL(request.url)
        const search = url.searchParams.get('search') || ''
        const department_id = url.searchParams.get('department_id')
        const status = url.searchParams.get('status') || 'active' // active, resigned, terminated, all
        const page = parseInt(url.searchParams.get('page') || '1', 10)
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)

        let query = supabase
            .from('users')
            .select(`
                id, full_name, email, phone, avatar_url, role_code, is_active,
                department_id, manager_user_id, position_id, employee_no,
                employment_type, employment_status, join_date,
                roles:role_code (role_name, role_level),
                positions:position_id (name),
                departments:department_id (dept_name, dept_code)
            `, { count: 'exact' })
            .eq('organization_id', caller.organization_id)
            .order('full_name', { ascending: true })
            .range((page - 1) * limit, page * limit - 1)

        if (status !== 'all') {
            if (status === 'active') {
                query = query.eq('is_active', true)
            } else {
                query = query.eq('employment_status', status)
            }
        }

        if (department_id && department_id !== 'all') {
            query = query.eq('department_id', department_id)
        }

        if (search) {
            query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
        }

        const { data, error, count } = await query

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        // Resolve manager names
        const managerIds = [...new Set((data || []).map((u: any) => u.manager_user_id).filter(Boolean))]
        const managerMap = new Map<string, string>()
        if (managerIds.length > 0) {
            const { data: managers } = await supabase
                .from('users')
                .select('id, full_name')
                .in('id', managerIds)
                ; (managers || []).forEach((m: any) => managerMap.set(m.id, m.full_name || 'Unknown'))
        }

        const employees = (data || []).map((u: any) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            phone: u.phone,
            avatar_url: u.avatar_url,
            role_code: u.role_code,
            role_name: u.roles?.role_name || null,
            role_level: u.roles?.role_level ?? null,
            is_active: u.is_active,
            department_id: u.department_id,
            department_name: u.departments?.dept_name || null,
            department_code: u.departments?.dept_code || null,
            position_id: u.position_id,
            position_name: u.positions?.name || null,
            manager_user_id: u.manager_user_id,
            manager_name: u.manager_user_id ? managerMap.get(u.manager_user_id) || null : null,
            employee_no: u.employee_no ?? null,
            employment_type: u.employment_type || null,
            employment_status: u.employment_status || 'active',
            join_date: u.join_date || null,
        }))

        return NextResponse.json({
            success: true,
            data: employees,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Get caller context
        const { data: caller } = await supabase
            .from('users')
            .select('organization_id, roles:role_code(role_level)')
            .eq('id', user.id)
            .single()

        if (!caller?.organization_id) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        const roleLevel = caller.roles?.role_level ?? 99
        if (roleLevel > 20) {
            return NextResponse.json({ success: false, error: 'Insufficient permissions. Manager level or above required.' }, { status: 403 })
        }

        const body = await request.json()
        const {
            full_name,
            email,
            phone,
            role_code = 'staff',
            department_id,
            position_id,
            manager_user_id,
            employment_type = 'Full-time',
            employment_status = 'active',
            join_date,
            create_login = false,
        } = body

        if (!full_name || !email) {
            return NextResponse.json({ success: false, error: 'full_name and email are required' }, { status: 400 })
        }

        // Validate email is unique
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle()

        if (existingUser) {
            return NextResponse.json({ success: false, error: 'An employee with this email already exists.' }, { status: 409 })
        }

        // Validate department belongs to org
        if (department_id) {
            const { data: dept } = await supabase
                .from('departments')
                .select('id')
                .eq('id', department_id)
                .eq('organization_id', caller.organization_id)
                .maybeSingle()
            if (!dept) {
                return NextResponse.json({ success: false, error: 'Selected department not found in your organization.' }, { status: 400 })
            }
        }

        // Validate position belongs to org
        if (position_id) {
            const { data: pos } = await supabase
                .from('hr_positions')
                .select('id')
                .eq('id', position_id)
                .eq('organization_id', caller.organization_id)
                .maybeSingle()
            if (!pos) {
                return NextResponse.json({ success: false, error: 'Selected position not found in your organization.' }, { status: 400 })
            }
        }

        // Validate manager belongs to org
        if (manager_user_id) {
            const { data: mgr } = await supabase
                .from('users')
                .select('id')
                .eq('id', manager_user_id)
                .eq('organization_id', caller.organization_id)
                .maybeSingle()
            if (!mgr) {
                return NextResponse.json({ success: false, error: 'Selected manager not found in your organization.' }, { status: 400 })
            }
        }

        let userId: string
        let tempPassword: string | null = null

        if (create_login) {
            // Create auth user via admin API
            const adminClient = createAdminClient()
            if (!adminClient) {
                return NextResponse.json({ success: false, error: 'Admin client not available.' }, { status: 500 })
            }

            tempPassword = generateTempPassword()
            const normalizedPhone = phone ? normalizePhone(phone) : undefined

            const { data: authUser, error: createError } = await adminClient.auth.admin.createUser({
                email: email.toLowerCase().trim(),
                password: tempPassword,
                email_confirm: true,
                phone: normalizedPhone,
                phone_confirm: !!normalizedPhone,
                user_metadata: { full_name },
            })

            if (createError || !authUser?.user?.id) {
                return NextResponse.json({ success: false, error: createError?.message || 'Failed to create login' }, { status: 500 })
            }

            userId = authUser.user.id

            // Sync to public.users table
            const { error: syncError } = await supabase.rpc('sync_user_profile', {
                p_user_id: userId,
                p_email: email.toLowerCase().trim(),
                p_role_code: role_code,
                p_organization_id: caller.organization_id,
                p_full_name: full_name,
                p_phone: normalizedPhone,
            })

            if (syncError) {
                // Rollback auth user
                try { await adminClient.auth.admin.deleteUser(userId) } catch (_) { }
                return NextResponse.json({ success: false, error: syncError.message }, { status: 500 })
            }
        } else {
            // Create user record directly (no auth login). Use a placeholder ID.
            // Insert into users table directly with a generated UUID.
            const newId = crypto.randomUUID()
            const { error: insertError } = await supabase
                .from('users')
                .insert({
                    id: newId,
                    email: email.toLowerCase().trim(),
                    full_name,
                    phone: phone ? normalizePhone(phone) : null,
                    role_code,
                    organization_id: caller.organization_id,
                    is_active: true,
                })

            if (insertError) {
                return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
            }

            userId = newId
        }

        // Update HR-specific fields
        const hrUpdates: Record<string, any> = {}
        if (department_id) hrUpdates.department_id = department_id
        if (position_id) hrUpdates.position_id = position_id
        if (manager_user_id) hrUpdates.manager_user_id = manager_user_id
        if (employment_type) hrUpdates.employment_type = employment_type
        if (employment_status) hrUpdates.employment_status = employment_status
        if (join_date) hrUpdates.join_date = join_date

        if (Object.keys(hrUpdates).length > 0) {
            const { error: updateError } = await supabase
                .from('users')
                .update(hrUpdates)
                .eq('id', userId)

            if (updateError) {
                console.error('Failed to set HR fields:', updateError)
            }
        }

        // Fetch the created employee for response
        const { data: newEmployee } = await supabase
            .from('users')
            .select('id, full_name, email, employee_no, employment_type, employment_status')
            .eq('id', userId)
            .single()

        return NextResponse.json({
            success: true,
            data: {
                ...newEmployee,
                temp_password: tempPassword,
            },
        })
    } catch (error: any) {
        console.error('Failed to create employee:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

function generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$%'
    let password = ''
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
}
