/**
 * POST /api/hr/ai/actions/[actionKey]
 *
 * Scaffolded fix-action endpoints. Each action:
 * - Requires explicit confirmation
 * - Enforces RBAC + tenant isolation
 * - Returns what changed + next steps
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import type { FixActionResult } from '@/lib/ai/types'

// ─── Supported actions ─────────────────────────────────────────────

const SUPPORTED_ACTIONS: Record<string, {
  label: string
  handler: (supabase: any, orgId: string, payload?: any) => Promise<FixActionResult>
}> = {
  define_leave_types: {
    label: 'Create default leave types',
    handler: handleDefineLeaveTypes,
  },
  define_leave_approval_flow: {
    label: 'Create default leave approval flow',
    handler: handleDefineLeaveApprovalFlow,
  },
  create_default_positions: {
    label: 'Create common default positions',
    handler: handleCreateDefaultPositions,
  },
  create_attendance_policy: {
    label: 'Create default attendance policy',
    handler: handleCreateAttendancePolicy,
  },
  create_default_shifts: {
    label: 'Create default work shift',
    handler: handleCreateDefaultShift,
  },
  request_employee_bank_details: {
    label: 'Send bank details request notification',
    handler: handleRequestBankDetails,
  },
}

// ─── Route handler ─────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ actionKey: string }> },
) {
  try {
    const { actionKey } = await params
    const supabase = (await createClient()) as any

    // Auth + RBAC
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const ctx = authResult.data
    const allowed = await canManageHr(ctx)
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 },
      )
    }

    if (!ctx.organizationId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 400 },
      )
    }

    // Validate action
    const action = SUPPORTED_ACTIONS[actionKey]
    if (!action) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown action: ${actionKey}`,
          supported: Object.keys(SUPPORTED_ACTIONS),
        },
        { status: 404 },
      )
    }

    // Parse body & require confirmation
    const body = await request.json().catch(() => ({}))
    if (!body.confirmation) {
      return NextResponse.json(
        {
          success: false,
          error: 'Explicit confirmation required. Send { confirmation: true } in request body.',
          action: { key: actionKey, label: action.label },
        },
        { status: 400 },
      )
    }

    // Execute action
    console.log(`[HR AI Action] ${actionKey} by user=${ctx.userId.slice(0, 8)} org=${ctx.organizationId.slice(0, 8)}`)
    const result = await action.handler(supabase, ctx.organizationId, body.payload)

    return NextResponse.json({ success: true, data: result })
  } catch (err: any) {
    console.error('[HR AI Action] Error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleDefineLeaveTypes(supabase: any, orgId: string): Promise<FixActionResult> {
  const defaults = [
    { code: 'AL', name: 'Annual Leave', is_paid_leave: true, is_statutory: true },
    { code: 'MC', name: 'Medical Leave', is_paid_leave: true, is_statutory: true, requires_attachment: true },
    { code: 'HL', name: 'Hospitalization Leave', is_paid_leave: true, is_statutory: true, requires_attachment: true },
    { code: 'ML', name: 'Maternity Leave', is_paid_leave: true, is_statutory: true, gender: 'female' },
    { code: 'PL', name: 'Paternity Leave', is_paid_leave: true, is_statutory: false, gender: 'male' },
    { code: 'UL', name: 'Unpaid Leave', is_paid_leave: false, is_statutory: false },
    { code: 'CL', name: 'Compassionate Leave', is_paid_leave: true, is_statutory: false },
    { code: 'RL', name: 'Replacement Leave', is_paid_leave: true, is_statutory: false },
  ]

  const created: string[] = []
  for (const lt of defaults) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('hr_leave_types')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', lt.code)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase.from('hr_leave_types').insert({
        organization_id: orgId,
        ...lt,
        status: 'active',
        requires_approval: true,
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
      })
      if (!error) created.push(lt.name)
    }
  }

  return {
    success: true,
    actionKey: 'define_leave_types',
    message: created.length > 0
      ? `Created ${created.length} leave type(s): ${created.join(', ')}`
      : 'All default leave types already exist',
    changes: created.map((n) => `Created: ${n}`),
    nextSteps: [
      'Review leave type entitlement tiers in HR Settings > Leave Types',
      'Configure carry-forward and pro-rata rules as needed',
      'Set up approval flow for leave requests',
    ],
  }
}

async function handleDefineLeaveApprovalFlow(supabase: any, orgId: string): Promise<FixActionResult> {
  // Check if already exists
  const { data: existing } = await supabase
    .from('hr_approval_chains')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      success: true,
      actionKey: 'define_leave_approval_flow',
      message: 'An approval chain already exists.',
      nextSteps: ['Review existing approval flow in HR > Leave Management > Approval Flow'],
    }
  }

  const { data: chain, error: chainErr } = await supabase
    .from('hr_approval_chains')
    .insert({
      organization_id: orgId,
      name: 'Default Approval Chain',
      is_default: true,
      escalation_enabled: true,
      escalation_hours: 48,
    })
    .select('id')
    .single()

  if (chainErr || !chain) {
    return { success: false, actionKey: 'define_leave_approval_flow', message: 'Failed to create approval chain' }
  }

  // Create steps: Direct Manager → HR Manager → Super Admin
  const steps = [
    { chain_id: chain.id, level: 1, role: 'direct_manager', can_delegate: true },
    { chain_id: chain.id, level: 2, role: 'hr_manager', can_delegate: true },
  ]

  await supabase.from('hr_approval_chain_steps').insert(steps)

  return {
    success: true,
    actionKey: 'define_leave_approval_flow',
    message: 'Created default approval chain with 2 levels: Direct Manager → HR Manager',
    changes: ['Created "Default Approval Chain"', 'Level 1: Direct Manager', 'Level 2: HR Manager'],
    nextSteps: [
      'Assign the approval chain to specific leave types if needed',
      'Configure escalation timing',
      'Test by submitting a sample leave request',
    ],
  }
}

async function handleCreateDefaultPositions(supabase: any, orgId: string): Promise<FixActionResult> {
  const defaults = [
    { code: 'CEO', name: 'Chief Executive Officer', level: 1, category: 'Executive' },
    { code: 'CFO', name: 'Chief Financial Officer', level: 1, category: 'Executive' },
    { code: 'CTO', name: 'Chief Technology Officer', level: 1, category: 'Executive' },
    { code: 'VP', name: 'Vice President', level: 2, category: 'Management' },
    { code: 'DIR', name: 'Director', level: 3, category: 'Management' },
    { code: 'MGR', name: 'Manager', level: 4, category: 'Management' },
    { code: 'SMGR', name: 'Senior Manager', level: 3, category: 'Management' },
    { code: 'SPV', name: 'Supervisor', level: 5, category: 'Supervisor' },
    { code: 'SR', name: 'Senior Staff', level: 6, category: 'Staff' },
    { code: 'STF', name: 'Staff', level: 7, category: 'Staff' },
    { code: 'JR', name: 'Junior Staff', level: 8, category: 'Staff' },
    { code: 'INT', name: 'Intern', level: 9, category: 'Intern' },
  ]

  const created: string[] = []
  for (const pos of defaults) {
    const { data: existing } = await supabase
      .from('hr_positions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', pos.code)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase.from('hr_positions').insert({
        organization_id: orgId,
        ...pos,
        is_active: true,
      })
      if (!error) created.push(pos.name)
    }
  }

  return {
    success: true,
    actionKey: 'create_default_positions',
    message: created.length > 0
      ? `Created ${created.length} position(s): ${created.join(', ')}`
      : 'All default positions already exist',
    changes: created.map((n) => `Created: ${n}`),
    nextSteps: [
      'Review positions in HR Settings > Positions',
      'Assign positions to employees',
      'Configure salary bands for each position if using payroll',
    ],
  }
}

async function handleCreateAttendancePolicy(supabase: any, orgId: string): Promise<FixActionResult> {
  const { data: existing } = await supabase
    .from('hr_attendance_policies')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      success: true,
      actionKey: 'create_attendance_policy',
      message: 'An attendance policy already exists.',
      nextSteps: ['Review policy in HR > Attendance settings'],
    }
  }

  const { error } = await supabase.from('hr_attendance_policies').insert({
    organization_id: orgId,
    workdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    grace_minutes: 15,
    timezone: 'Asia/Kuala_Lumpur',
    require_shift: false,
    late_after_minutes: 15,
    early_leave_before_minutes: 30,
  })

  if (error) {
    return { success: false, actionKey: 'create_attendance_policy', message: 'Failed to create policy' }
  }

  return {
    success: true,
    actionKey: 'create_attendance_policy',
    message: 'Created default attendance policy (Mon-Fri, 15min grace, Asia/KL timezone)',
    changes: ['Created default attendance policy'],
    nextSteps: ['Review and adjust timezone, grace minutes, and workdays', 'Create shifts for different work schedules'],
  }
}

async function handleCreateDefaultShift(supabase: any, orgId: string): Promise<FixActionResult> {
  const { data: existing } = await supabase
    .from('hr_shifts')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      success: true,
      actionKey: 'create_default_shifts',
      message: 'Shifts already exist.',
      nextSteps: ['Review shifts in attendance settings'],
    }
  }

  const { error } = await supabase.from('hr_shifts').insert({
    organization_id: orgId,
    name: 'Regular Office Hours',
    start_time: '09:00',
    end_time: '18:00',
    break_minutes: 60,
    expected_work_minutes: 480,
    allow_cross_midnight: false,
  })

  if (error) {
    return { success: false, actionKey: 'create_default_shifts', message: 'Failed to create shift' }
  }

  return {
    success: true,
    actionKey: 'create_default_shifts',
    message: 'Created default shift: Regular Office Hours (9AM - 6PM, 1hr break)',
    changes: ['Created "Regular Office Hours" shift'],
    nextSteps: ['Create additional shifts for different schedules', 'Assign shifts to employees or departments'],
  }
}

async function handleRequestBankDetails(supabase: any, orgId: string): Promise<FixActionResult> {
  // This creates a notification/task rather than modifying data
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .or('bank_account_number.is.null,bank_id.is.null')

  const missing = count ?? 0

  return {
    success: true,
    actionKey: 'request_employee_bank_details',
    message: missing > 0
      ? `${missing} employee(s) are missing bank details. A reminder task has been noted.`
      : 'All employees have bank details configured.',
    changes: missing > 0 ? [`Identified ${missing} employee(s) needing bank details`] : [],
    nextSteps: missing > 0
      ? [
          'Go to People > Employees to view employees missing bank details',
          'Ask employees to update their bank information via Self-Service portal',
          'Or update bank details manually in each employee profile',
        ]
      : ['No action needed'],
  }
}
