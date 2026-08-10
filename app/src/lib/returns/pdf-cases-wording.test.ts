/**
 * @vitest-environment jsdom
 *
 * Product Return Note PDF — unit wording is "CASES", never "BOX".
 *
 * Generates a real PDF for a flavour (Cellera Zero) + device (S.Box) return and
 * inspects the uncompressed content streams for the drawn strings.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { generateReturnPdf } from './pdf'
import type { ReturnCase } from './types'

const RC = {
    id: 'r1',
    return_no: 'RET26-000009',
    status: 'return_completed',
    source_type: 'shop',
    reported_date: '2026-07-14',
    created_at: '2026-07-14T00:00:00Z',
    total_qty: 9,
    total_value: 1788,
    shop: { id: 's1', org_name: '24 Street Vapor', org_code: 'SH003' },
    warehouse: { id: 'w1', org_name: 'Serapod Warehouse Balakong', org_code: 'WH001' },
    items: [
        {
            id: 'i1', product_name: 'Cellera Zero', variant_name: 'Zero Edition Novella [ Buttercake ]',
            reason: 'Defective', case_qty: 2, loose_piece_qty: 1, total_units: 9, quantity: 9,
        },
        {
            id: 'i2', product_name: 'Serapod Device S.Box', variant_name: 'Serapod Device S.Box',
            reason: 'Defective', case_qty: 0, loose_piece_qty: 3, total_units: 3, quantity: 3,
        },
    ],
} as unknown as ReturnCase

let pdfText = ''

beforeAll(async () => {
    // Preview mode writes the PDF to a blob URL — capture the Blob instead of
    // opening a window, then read the (uncompressed) PDF content streams.
    const blobs: Blob[] = []
    vi.stubGlobal('open', vi.fn())
    // jsdom never fetches images; fail them fast so the best-effort banner
    // loading in generateReturnPdf falls through instead of hanging.
    vi.stubGlobal('Image', class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        crossOrigin = ''
        naturalWidth = 0
        naturalHeight = 0
        set src(_v: string) { queueMicrotask(() => this.onerror?.()) }
    })
    const createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:mock' })
    Object.defineProperty(globalThis.URL, 'createObjectURL', { value: createObjectURL, writable: true })

    await generateReturnPdf(RC, { preview: true })
    expect(blobs).toHaveLength(1)
    pdfText = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer).toString('latin1'))
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(blobs[0])
    })
})

describe('Product Return Note PDF unit wording', () => {
    it('uses CASES for the flavour quantity column and the summary card', () => {
        expect(pdfText).toContain('CASES')
        expect(pdfText).toContain('TOTAL CASES')
    })

    it('never prints BOX as a unit label', () => {
        // "S.BOX" is an official device product line name and stays as-is.
        const boxHits = pdfText.match(/BOX/g) || []
        const sboxHits = pdfText.match(/S\.BOX/g) || []
        expect(boxHits.length).toBe(sboxHits.length)
    })

    it('still renders the device section heading DEVICE S.BOX (product name, not a unit)', () => {
        expect(pdfText).toContain('DEVICE S.BOX')
    })
})
