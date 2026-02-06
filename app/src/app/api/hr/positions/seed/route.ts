import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageHr, getHrAuthContext } from '@/lib/server/hrAccess'

const TEMPLATE_SETS: Record<string, { label: string; positions: { code: string; name: string; category: string; level: number }[] }> = {
    standard_sme_my: {
        label: 'Standard SME (MY)',
        positions: [
            { code: 'CEO', name: 'Chief Executive Officer', category: 'Executive', level: 1 },
            { code: 'COO', name: 'Chief Operating Officer', category: 'Executive', level: 1 },
            { code: 'CFO', name: 'Chief Financial Officer', category: 'Executive', level: 1 },
            { code: 'CTO', name: 'Chief Technology Officer', category: 'Executive', level: 1 },
            { code: 'HRM', name: 'HR Manager', category: 'Management', level: 2 },
            { code: 'FIN-MGR', name: 'Finance Manager', category: 'Management', level: 2 },
            { code: 'IT-MGR', name: 'IT Manager', category: 'Management', level: 2 },
            { code: 'WH-MGR', name: 'Warehouse Manager', category: 'Management', level: 2 },
            { code: 'SALES-MGR', name: 'Sales Manager', category: 'Management', level: 2 },
            { code: 'DESIGN-MGR', name: 'Design Manager', category: 'Management', level: 2 },
            { code: 'HR-EXEC', name: 'HR Executive', category: 'Staff', level: 4 },
            { code: 'ACC-EXEC', name: 'Accounts Executive', category: 'Staff', level: 4 },
            { code: 'IT-ENG', name: 'IT Engineer', category: 'Staff', level: 4 },
            { code: 'WH-OP', name: 'Warehouse Operator', category: 'Staff', level: 5 },
            { code: 'SALES-EXEC', name: 'Sales Executive', category: 'Staff', level: 4 },
            { code: 'DESIGNER', name: 'Designer', category: 'Staff', level: 4 }
        ]
    },
    retail_warehouse: {
        label: 'Retail + Warehouse',
        positions: [
            { code: 'CEO', name: 'Chief Executive Officer', category: 'Executive', level: 1 },
            { code: 'COO', name: 'Chief Operating Officer', category: 'Executive', level: 1 },
            { code: 'CFO', name: 'Chief Financial Officer', category: 'Executive', level: 1 },
            { code: 'HRM', name: 'HR Manager', category: 'Management', level: 2 },
            { code: 'FIN-MGR', name: 'Finance Manager', category: 'Management', level: 2 },
            { code: 'IT-MGR', name: 'IT Manager', category: 'Management', level: 2 },
            { code: 'WH-MGR', name: 'Warehouse Manager', category: 'Management', level: 2 },
            { code: 'RETAIL-MGR', name: 'Retail Manager', category: 'Management', level: 2 },
            { code: 'SALES-EXEC', name: 'Sales Executive', category: 'Staff', level: 4 },
            { code: 'CASHIER', name: 'Cashier', category: 'Staff', level: 5 },
            { code: 'WH-OP', name: 'Warehouse Operator', category: 'Staff', level: 5 },
            { code: 'STORE-ASSOC', name: 'Store Associate', category: 'Staff', level: 5 }
        ]
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = (await createClient()) as any
        const ctxResult = await getHrAuthContext(supabase)
        if (!ctxResult.success || !ctxResult.data) {
            return NextResponse.json({ success: false, error: ctxResult.error }, { status: 401 })
        }

        const ctx = ctxResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 400 })
        }

        if (!(await canManageHr(ctx))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }

        const body = await request.json()
        const templateKey = String(body.template || '')
        const template = TEMPLATE_SETS[templateKey]

        if (!template) {
            return NextResponse.json({ success: false, error: 'Invalid template' }, { status: 400 })
        }

        const payload = template.positions.map(position => ({
            organization_id: ctx.organizationId,
            code: position.code,
            name: position.name,
            category: position.category,
            level: position.level,
            is_active: true
        }))

        const existing = await supabase
            .from('hr_positions')
            .select('code')
            .eq('organization_id', ctx.organizationId)
            .in('code', payload.map(p => p.code))

        const existingCodes = new Set((existing.data || []).map((row: any) => row.code))

        const { data, error } = await supabase
            .from('hr_positions')
            .upsert(payload, { onConflict: 'organization_id,code' })
            .select('id, code')

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        const total = data?.length || payload.length
        const updated = existingCodes.size
        const inserted = Math.max(total - updated, 0)

        return NextResponse.json({
            success: true,
            data: {
                inserted,
                updated
            }
        })
    } catch (error: any) {
        console.error('Failed to seed HR positions:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    }
}
