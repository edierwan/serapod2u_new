import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getReturnContext } from '@/lib/returns/server'
import { decorateCase } from '@/lib/returns/compute'
import { RETURN_STATUS_LABELS, type ReturnStatus } from '@/lib/returns/constants'
import type { ReturnSettings } from '@/lib/returns/types'

const ORG_SELECT = 'id, org_code, org_name'

async function loadSettings(admin: any): Promise<ReturnSettings> {
    const { data } = await admin.from('return_settings').select('*').eq('id', 1).maybeSingle()
    return data || {
        default_return_warehouse_id: null,
        sla_submitted_to_received_days: 3,
        sla_received_to_processing_days: 2,
        sla_processing_to_completed_days: 5,
        pdf_instruction_text: null,
        shop_self_service_enabled: true,
    }
}

/** GET /api/returns/reporting/export — download the filtered report as an .xlsx. */
export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const sp = request.nextUrl.searchParams
    let query = ctx.admin
        .from('return_cases')
        .select(`*, items:return_case_items (*)`)
        .order('created_at', { ascending: false })

    if (!ctx.isManager) {
        query = query.eq('shop_org_id', ctx.orgId || '00000000-0000-0000-0000-000000000000')
    } else if (sp.get('shop')) {
        query = query.eq('shop_org_id', sp.get('shop'))
    }
    if (sp.get('status')) query = query.eq('status', sp.get('status'))
    if (sp.get('warehouse')) query = query.eq('return_warehouse_id', sp.get('warehouse'))
    if (sp.get('from')) query = query.gte('created_at', sp.get('from'))
    if (sp.get('to')) query = query.lte('created_at', sp.get('to'))

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const settings = await loadSettings(ctx.admin)
    const orgIds = Array.from(new Set(
        (data || []).flatMap((r: any) => [r.shop_org_id, r.return_warehouse_id]).filter(Boolean),
    ))
    let orgMap: Record<string, any> = {}
    if (orgIds.length > 0) {
        const { data: orgs } = await ctx.admin.from('organizations').select(ORG_SELECT).in('id', orgIds)
        orgMap = Object.fromEntries((orgs || []).map((o: any) => [o.id, o]))
    }

    const rows = (data || []).map((r: any) =>
        decorateCase({ ...r, shop: orgMap[r.shop_org_id] || null, warehouse: orgMap[r.return_warehouse_id] || null }, settings),
    )

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Return Report')
    ws.columns = [
        { header: 'Return No', key: 'return_no', width: 20 },
        { header: 'Shop', key: 'shop', width: 26 },
        { header: 'Warehouse', key: 'warehouse', width: 26 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Total Qty', key: 'qty', width: 12 },
        { header: 'Total Value (RM)', key: 'value', width: 16 },
        { header: 'Created Date', key: 'created', width: 20 },
        { header: 'Last Updated', key: 'updated', width: 20 },
        { header: 'Days Open', key: 'days', width: 12 },
        { header: 'Overdue', key: 'overdue', width: 10 },
    ]
    ws.getRow(1).font = { bold: true }

    for (const r of rows) {
        ws.addRow({
            return_no: r.return_no,
            shop: r.shop?.org_name || '',
            warehouse: r.warehouse?.org_name || '',
            status: RETURN_STATUS_LABELS[r.status as ReturnStatus] || r.status,
            qty: r.total_qty ?? 0,
            value: Number(r.total_value ?? 0).toFixed(2),
            created: r.created_at ? new Date(r.created_at).toLocaleString('en-MY') : '',
            updated: r.updated_at ? new Date(r.updated_at).toLocaleString('en-MY') : '',
            days: r.days_open ?? 0,
            overdue: r.is_overdue ? 'Yes' : 'No',
        })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const filename = `return-report-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new NextResponse(buffer as any, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
