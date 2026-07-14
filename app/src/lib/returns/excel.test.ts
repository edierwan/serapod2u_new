import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
    buildReturnExcelFilename, buildReturnWorkbook, parseReturnWorkbook,
    RETURN_EXCEL_TEMPLATE_VERSION, METADATA_SHEET, ITEMS_SHEET,
    type ReturnExcelContext, type ReturnExcelRowInput,
} from './excel'
import type { ProductLine, EntryUnit } from './format'

const REASONS = [
    { code: 'defective', label: 'Defective' },
    { code: 'damaged', label: 'Damaged' },
]
const CONDITIONS = [
    { code: 'unopened', label: 'Unopened' },
    { code: 'opened', label: 'Opened' },
]

function ctx(overrides: Partial<ReturnExcelContext> = {}): ReturnExcelContext {
    return {
        returnId: 'ret-1', returnNo: 'RET26-000003',
        sourceType: 'shop',
        shopId: 'shop-1', shopCode: 'SH005', shopName: 'Shop Five',
        warehouseId: 'wh-1', warehouseCode: 'WH01', warehouseName: 'Main WH',
        reportedDate: '2026-07-12',
        programCode: 'cellera', programName: 'Cellera',
        categoryId: 'cat-1', categoryName: 'Vape',
        organizationId: 'org-1', instructionText: null,
        reasons: REASONS, conditions: CONDITIONS,
        ...overrides,
    }
}

function row(over: Partial<ReturnExcelRowInput> & { key: string; product_line: ProductLine }): ReturnExcelRowInput {
    return {
        product_id: `p-${over.key}`, variant_id: `v-${over.key}`, sku: `sku-${over.key}`,
        manual_sku: `MSKU-${over.key}`, barcode: `BC-${over.key}`,
        product_name: 'Cellera Hero', variant_name: 'Hero [ Mango ]',
        units_per_case: 4, entry_unit: 'pcs' as EntryUnit,
        entered_pcs: 0, entered_box_qty: 0, entered_extra_pcs: 0,
        case_qty: 0, loose_piece_qty: 0, total_units: 0,
        reason: null, condition: null, notes: null,
        ...over,
    }
}

const HERO = row({ key: 'hero', product_line: 'hero', product_name: 'Cellera Hero' })
const ZERO = row({ key: 'zero', product_line: 'zero', product_name: 'Cellera Zero' })
const SLINE = row({ key: 'sline', product_line: 'sline', product_name: 'Serapod Device S.Line', units_per_case: 1 })
const SBOX = row({ key: 'sbox', product_line: 'sbox', product_name: 'Serapod Device S.Box', units_per_case: 1 })

/** Load a workbook we can mutate cell-by-cell to simulate a user-edited file. */
async function reload(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    return wb
}

function headerRow(sheet: ExcelJS.Worksheet): number {
    let n = -1
    sheet.eachRow((r, i) => {
        if (n < 0 && String(r.getCell(1).value || '').toLowerCase() === 'product line') n = i
    })
    return n
}

/** Find the Excel data row whose Variant ID (col 4) equals `variantId`. */
function findRow(sheet: ExcelJS.Worksheet, variantId: string): ExcelJS.Row {
    const h = headerRow(sheet)
    let target: ExcelJS.Row | null = null
    sheet.eachRow((r, i) => {
        if (i > h && String(r.getCell(4).value || '') === variantId) target = r
    })
    if (!target) throw new Error(`row ${variantId} not found`)
    return target
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

describe('buildReturnExcelFilename', () => {
    it('uses the return number when saved', () => {
        expect(buildReturnExcelFilename(ctx())).toBe('Return-Worksheet-RET26-000003.xlsx')
    })
    it('falls back to shop code + date when not saved', () => {
        expect(buildReturnExcelFilename(ctx({ returnNo: null }))).toBe('Return-Worksheet-SH005-2026-07-12.xlsx')
    })
})

describe('buildReturnWorkbook (export)', () => {
    it('creates a hidden metadata sheet and a visible items sheet with all columns', async () => {
        const wb = await buildReturnWorkbook(ctx(), [HERO, ZERO, SLINE, SBOX])
        const meta = wb.getWorksheet(METADATA_SHEET)!
        const items = wb.getWorksheet(ITEMS_SHEET)!
        expect(meta).toBeTruthy()
        expect(meta.state).toBe('veryHidden')
        expect(items.state).not.toBe('veryHidden')
        // Template identity is present.
        const metaMap = new Map<string, string>()
        meta.eachRow((r) => metaMap.set(String(r.getCell(1).value || '').toLowerCase(), String(r.getCell(2).value || '')))
        expect(metaMap.get('template version')).toBe(RETURN_EXCEL_TEMPLATE_VERSION)
        expect(metaMap.get('shop id')).toBe('shop-1')
        // Header row exists with the 15 expected columns.
        const h = headerRow(items)
        expect(h).toBeGreaterThan(0)
        expect(String(items.getRow(h).getCell(8).value)).toBe('Return Quantity')
    })

    it('exports existing UI quantities (Hero PCS + Zero Box) without resetting them', async () => {
        const heroFilled = { ...HERO, entry_unit: 'pcs' as EntryUnit, entered_pcs: 5, total_units: 5, case_qty: 1, loose_piece_qty: 1, reason: 'defective', condition: 'opened' }
        const zeroFilled = { ...ZERO, entry_unit: 'box' as EntryUnit, entered_box_qty: 2, entered_extra_pcs: 1, total_units: 9, case_qty: 2, loose_piece_qty: 1 }
        const wb = await buildReturnWorkbook(ctx(), [heroFilled, zeroFilled])
        const items = wb.getWorksheet(ITEMS_SHEET)!
        const hRow = findRow(items, 'v-hero')
        expect(String(hRow.getCell(7).value)).toBe('PCS')
        expect(Number(hRow.getCell(8).value)).toBe(5)   // Return Quantity = total pcs
        expect(Number(hRow.getCell(12).value)).toBe(5)  // Total PCS
        expect(String(hRow.getCell(13).value)).toBe('Defective') // reason label
        const zRow = findRow(items, 'v-zero')
        expect(String(zRow.getCell(7).value)).toBe('Box')
        expect(Number(zRow.getCell(8).value)).toBe(2)   // full boxes
        expect(Number(zRow.getCell(10).value)).toBe(1)  // loose extra pcs
        expect(Number(zRow.getCell(12).value)).toBe(9)  // total = 2*4 + 1
    })

    it('forces devices to PCS with no pack size', async () => {
        const wb = await buildReturnWorkbook(ctx(), [{ ...SLINE, entered_pcs: 3, total_units: 3 }])
        const items = wb.getWorksheet(ITEMS_SHEET)!
        const r = findRow(items, 'v-sline')
        expect(String(r.getCell(7).value)).toBe('PCS')
        expect(r.getCell(9).value === '' || r.getCell(9).value == null).toBe(true) // PCS per box blank
        expect(Number(r.getCell(12).value)).toBe(3)
    })
})

describe('parseReturnWorkbook (import validation + matching)', () => {
    const current = [HERO, ZERO, SLINE, SBOX]

    async function exportThenEdit(edit: (items: ExcelJS.Worksheet, meta: ExcelJS.Worksheet) => void) {
        const wb0 = await buildReturnWorkbook(ctx(), current)
        const wb = await reload(await toBuffer(wb0))
        edit(wb.getWorksheet(ITEMS_SHEET)!, wb.getWorksheet(METADATA_SHEET)!)
        return parseReturnWorkbook(await toBuffer(wb), ctx(), current)
    }

    it('imports a valid Hero PCS quantity', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero')
            r.getCell(7).value = 'PCS'; r.getCell(8).value = 6; r.getCell(13).value = 'Defective'
        })
        expect(res.ok).toBe(true)
        expect(res.updates).toHaveLength(1)
        expect(res.updates[0]).toMatchObject({ rowKey: 'hero', entry_unit: 'pcs', entered_pcs: 6, reason: 'defective' })
    })

    it('imports a valid Hero Box + loose quantity', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero')
            r.getCell(7).value = 'Box'; r.getCell(8).value = 2; r.getCell(10).value = 3
        })
        expect(res.ok).toBe(true)
        expect(res.updates[0]).toMatchObject({ entry_unit: 'box', entered_box_qty: 2, entered_extra_pcs: 3 })
    })

    it('imports valid S.Line PCS', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-sline'); r.getCell(8).value = 4
        })
        expect(res.ok).toBe(true)
        expect(res.updates[0]).toMatchObject({ rowKey: 'sline', entry_unit: 'pcs', entered_pcs: 4 })
    })

    it('rejects a Device row using Box mode', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-sbox'); r.getCell(7).value = 'Box'; r.getCell(8).value = 2
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => x.status === 'error' && /PCS only/i.test(x.message))).toBe(true)
    })

    it('rejects a negative quantity', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero'); r.getCell(8).value = -2
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => /negative/i.test(x.message))).toBe(true)
    })

    it('rejects a decimal quantity', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero'); r.getCell(8).value = 2.5
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => /decimal/i.test(x.message))).toBe(true)
    })

    it('rejects an unknown product row', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero')
            r.getCell(3).value = 'p-ghost'; r.getCell(4).value = 'v-ghost'
            r.getCell(5).value = 'NOPE'; r.getCell(6).value = 'NOPE'; r.getCell(8).value = 2
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => /not found/i.test(x.message))).toBe(true)
    })

    it('rejects a modified Product ID', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero'); r.getCell(3).value = 'p-tampered'; r.getCell(8).value = 2
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => /Product ID/i.test(x.message))).toBe(true)
    })

    it('rejects a wrong-shop template', async () => {
        const wb0 = await buildReturnWorkbook(ctx(), current)
        const res = await parseReturnWorkbook(await toBuffer(wb0), ctx({ shopId: 'shop-OTHER' }), current)
        expect(res.ok).toBe(false)
        expect(res.fatalErrors.some((e) => /different shop/i.test(e))).toBe(true)
    })

    it('rejects a distributor template imported in shop mode', async () => {
        const wb0 = await buildReturnWorkbook(ctx({ sourceType: 'distributor', shopId: 'dist-1', shopName: 'ABC Distribution' }), current)
        const res = await parseReturnWorkbook(await toBuffer(wb0), ctx({ sourceType: 'shop' }), current)
        expect(res.ok).toBe(false)
        expect(res.fatalErrors.some((e) => /distributor return.*from a shop/i.test(e))).toBe(true)
    })

    it('rejects a wrong-category template', async () => {
        const wb0 = await buildReturnWorkbook(ctx(), current)
        const res = await parseReturnWorkbook(await toBuffer(wb0), ctx({ categoryId: 'cat-OTHER' }), current)
        expect(res.ok).toBe(false)
        expect(res.fatalErrors.some((e) => /different category/i.test(e))).toBe(true)
    })

    it('rejects a non-return-product file (missing metadata)', async () => {
        const wb = new ExcelJS.Workbook()
        wb.addWorksheet('Sheet1')
        const res = await parseReturnWorkbook(await toBuffer(wb), ctx(), current)
        expect(res.ok).toBe(false)
        expect(res.fatalErrors[0]).toMatch(/not a Return Product worksheet/i)
    })

    it('detects a duplicate product row', async () => {
        const res = await exportThenEdit((items) => {
            const r = findRow(items, 'v-hero'); r.getCell(8).value = 2
            // Append a second row for the same variant.
            const dup = items.addRow(['Hero', 'Hero [ Mango ]', 'p-hero', 'v-hero', 'MSKU-hero', 'BC-hero', 'PCS', 3, 4, 3, 0, 3, '', '', ''])
            void dup
        })
        expect(res.ok).toBe(false)
        expect(res.rows.some((x) => /Duplicate/i.test(x.message))).toBe(true)
    })

    it('ignores blank rows and skips zero-quantity rows (merge mode)', async () => {
        const res = await exportThenEdit(() => { /* export as-is, all quantities 0 */ })
        expect(res.ok).toBe(true)
        expect(res.updates).toHaveLength(0)
        expect(res.summary.skippedEmpty).toBe(current.length)
    })
})
