import { unlink } from 'fs/promises'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TRACKING_BASE_URL,
  generateQRExcel,
  generateTrackingURL,
  normalizeTrackingBaseUrl,
  resolveTrackingBaseUrl,
} from './excel-generator'
import { generateQRBatch } from './qr-generator'

const STAGING = 'https://stg.serapod2u.com'
const PRODUCT_CODE = 'PROD-CELVA9464-DEL-570507-ORD-HM-0926-30-00002-2a05954fff98'
const MASTER_CODE = 'MASTER-ORD-HM-0926-30-CASE-001-abc123def456'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tracking base URL resolution', () => {
  it('uses the staging URL when staging is configured', () => {
    expect(resolveTrackingBaseUrl('https://stg.serapod2u.com', undefined)).toBe(STAGING)
  })

  it('uses the production URL when production is configured', () => {
    expect(resolveTrackingBaseUrl('https://serapod2u.com', undefined)).toBe('https://serapod2u.com')
    expect(resolveTrackingBaseUrl('https://www.serapod2u.com', undefined)).toBe('https://www.serapod2u.com')
  })

  it('uses localhost for local development', () => {
    expect(resolveTrackingBaseUrl('http://localhost:3000', undefined)).toBe('http://localhost:3000')
  })

  it('strips trailing slashes and whitespace', () => {
    expect(normalizeTrackingBaseUrl('https://stg.serapod2u.com/')).toBe(STAGING)
    expect(normalizeTrackingBaseUrl('  https://stg.serapod2u.com///  ')).toBe(STAGING)
    expect(normalizeTrackingBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000')
  })

  it('adds https to a bare host and drops query/hash', () => {
    expect(normalizeTrackingBaseUrl('stg.serapod2u.com')).toBe(STAGING)
    expect(normalizeTrackingBaseUrl('https://stg.serapod2u.com/?x=1#y')).toBe(STAGING)
  })

  it('falls back to NEXT_PUBLIC_SITE_URL, then the default, for blank or invalid values', () => {
    expect(resolveTrackingBaseUrl('', 'https://stg.serapod2u.com/')).toBe(STAGING)
    expect(resolveTrackingBaseUrl('   ', undefined)).toBe(DEFAULT_TRACKING_BASE_URL)
    expect(resolveTrackingBaseUrl('javascript:alert(1)', undefined)).toBe(DEFAULT_TRACKING_BASE_URL)
    expect(resolveTrackingBaseUrl(undefined, undefined)).toBe(DEFAULT_TRACKING_BASE_URL)
  })

  it('reads NEXT_PUBLIC_APP_URL from the environment by default', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stg.serapod2u.com/')
    expect(resolveTrackingBaseUrl()).toBe(STAGING)
  })
})

describe('generateTrackingURL', () => {
  it('builds staging product URLs without a double slash', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stg.serapod2u.com/')
    expect(generateTrackingURL(PRODUCT_CODE, 'product')).toBe(`${STAGING}/track/product/${PRODUCT_CODE}`)
  })

  it('builds staging master URLs', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stg.serapod2u.com')
    expect(generateTrackingURL(MASTER_CODE, 'master')).toBe(`${STAGING}/track/master/${MASTER_CODE}`)
  })
})

describe('generateQRExcel with staging configured', () => {
  it('writes only staging tracking URLs and never localhost:3000', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stg.serapod2u.com/')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const batch = generateQRBatch({
      orderNo: 'ORD-HM-0926-30',
      manufacturerCode: 'MFG01',
      orderItems: [
        {
          product_id: 'p1',
          variant_id: 'v1',
          product_code: 'CELVA9464',
          variant_code: 'DEL-570507',
          product_name: 'Cellera',
          variant_name: 'Cellera [ Deluxe ]',
          qty: 20,
          units_per_case: 10,
        },
      ],
      bufferPercent: 10,
      unitsPerCase: 10,
      useIndividualCaseSizes: true,
    })

    const filePath = await generateQRExcel({
      orderNo: 'ORD-HM-0926-30',
      displayDocNo: 'ORD26000093',
      orderDate: '15/09/2026',
      companyName: 'HQ',
      manufacturerName: 'Manufacturer',
      masterCodes: batch.masterCodes,
      individualCodes: batch.individualCodes,
      totalMasterCodes: batch.totalMasterCodes,
      totalUniqueCodes: batch.totalUniqueCodes,
      totalBaseUnits: batch.totalBaseUnits,
      bufferPercent: batch.bufferPercent,
      extraQrMaster: 0,
    })

    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(filePath)

      const cellsBySheet = new Map<string, string[]>()
      workbook.eachSheet((sheet) => {
        const values: string[] = []
        sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.text ?? cell.value ?? ''))))
        cellsBySheet.set(sheet.name, values)
      })

      const everything = [...cellsBySheet.values()].flat()
      expect(everything.some((v) => v.includes('localhost'))).toBe(false)

      const urls = everything.flatMap((v) => v.match(/https?:\/\/[^\s"]+/g) ?? [])
      expect(urls.length).toBeGreaterThan(0)
      // The Summary sheet's "Base URL:" row is the bare origin; every other URL is a path under it.
      const offOrigin = urls.filter((url) => url !== STAGING && !url.startsWith(`${STAGING}/`))
      expect(offOrigin).toEqual([])
      expect(urls.filter((url) => url.slice(STAGING.length).startsWith('//'))).toEqual([])
      expect(cellsBySheet.get('Summary')).toEqual(
        expect.arrayContaining([STAGING, `${STAGING}/track/product/[CODE]`, `${STAGING}/track/master/[CODE]`])
      )

      const productUrls = urls.filter((u) => u.startsWith(`${STAGING}/track/product/PROD-`))
      const masterUrls = urls.filter((u) => u.startsWith(`${STAGING}/track/master/MASTER-`))
      expect(productUrls.length).toBeGreaterThanOrEqual(batch.individualCodes.length)
      expect(masterUrls.length).toBeGreaterThanOrEqual(batch.masterCodes.length)
    } finally {
      await unlink(filePath).catch(() => {})
    }
  })
})
