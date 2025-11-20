/**
 * Test Suite for QR Batch Case Number Logic
 * 
 * NOTE: This is a reference test file. Jest is not currently installed in this project.
 * To run these tests, install Jest first:
 * 
 * ```bash
 * npm install --save-dev jest @types/jest ts-jest
 * npx ts-jest config:init
 * ```
 * 
 * Then run: npm test
 * 
 * Validates that:
 * 1. Production codes have correct case numbers based on per-variant local sequence
 * 2. Buffer codes have null case numbers (not assigned to any case)
 * 3. Case numbers are calculated correctly with configurable case sizes
 */

// @ts-nocheck - Test file requires Jest to be installed
import { generateQRBatch, type QRCodeGenerationParams } from '../qr-generator'
import { generateQRExcel, type QRExcelData } from '../excel-generator'
import ExcelJS from 'exceljs'
import { unlink } from 'fs/promises'

describe('QR Batch Case Number Logic', () => {
  describe('Single Variant - 3000 production + 150 buffer (5%), case size 20', () => {
    let result: ReturnType<typeof generateQRBatch>
    
    const params: QRCodeGenerationParams = {
      orderNo: 'ORD-TEST-2024-01',
      manufacturerCode: 'MFG-001',
      orderItems: [
        {
          product_id: 'prod-001',
          variant_id: 'var-001',
          product_code: 'VAPE001',
          variant_code: 'MINT',
          product_name: 'Test Vape',
          variant_name: 'Mint Flavor',
          qty: 3000,
          units_per_case: 20
        }
      ],
      bufferPercent: 5,
      unitsPerCase: 20,
      useIndividualCaseSizes: true
    }

    beforeAll(() => {
      result = generateQRBatch(params)
    })

    test('generates correct total counts', () => {
      const productionCodes = result.individualCodes.filter(c => !c.is_buffer)
      const bufferCodes = result.individualCodes.filter(c => c.is_buffer)
      
      expect(result.totalBaseUnits).toBe(3000)
      expect(result.totalUniqueCodes).toBe(3150) // 3000 + 150 buffer
      expect(productionCodes.length).toBe(3000)
      expect(bufferCodes.length).toBe(150)
    })

    test('production codes have case numbers 1-150', () => {
      const productionCodes = result.individualCodes.filter(c => !c.is_buffer)
      
      // Get all unique case numbers from production codes
      const caseNumbers = new Set(productionCodes.map(c => c.case_number))
      
      // Should have exactly 150 distinct case numbers
      expect(caseNumbers.size).toBe(150)
      
      // Case numbers should be 1 through 150 (not 0 or null)
      const sortedCases = Array.from(caseNumbers).sort((a, b) => a - b)
      expect(sortedCases[0]).toBe(1)
      expect(sortedCases[sortedCases.length - 1]).toBe(150)
      
      // Check all numbers from 1-150 are present
      for (let i = 1; i <= 150; i++) {
        expect(caseNumbers.has(i)).toBe(true)
      }
    })

    test('each case number appears exactly 20 times (case size)', () => {
      const productionCodes = result.individualCodes.filter(c => !c.is_buffer)
      
      // Count occurrences of each case number
      const caseCounts = new Map<number, number>()
      productionCodes.forEach(code => {
        const count = caseCounts.get(code.case_number) || 0
        caseCounts.set(code.case_number, count + 1)
      })
      
      // Each case should have exactly 20 codes
      caseCounts.forEach((count, caseNum) => {
        expect(count).toBe(20)
      })
      
      // Should have 150 cases
      expect(caseCounts.size).toBe(150)
    })

    test('buffer codes have case_number = 0 (will be null in Excel)', () => {
      const bufferCodes = result.individualCodes.filter(c => c.is_buffer)
      
      expect(bufferCodes.length).toBe(150)
      
      // All buffer codes should have case_number = 0
      bufferCodes.forEach(code => {
        expect(code.case_number).toBe(0)
        expect(code.is_buffer).toBe(true)
      })
    })

    test('buffer codes do not have positive case numbers', () => {
      const bufferCodes = result.individualCodes.filter(c => c.is_buffer)
      
      // No buffer code should have a positive case number
      const bufferCaseNumbers = bufferCodes.map(c => c.case_number)
      const positiveNumbers = bufferCaseNumbers.filter(n => n > 0)
      
      expect(positiveNumbers.length).toBe(0)
    })
  })

  describe('Multiple Variants (7 variants) - Mixed case sizes', () => {
    let result: ReturnType<typeof generateQRBatch>
    
    const params: QRCodeGenerationParams = {
      orderNo: 'ORD-TEST-2024-02',
      manufacturerCode: 'MFG-001',
      orderItems: [
        { product_id: 'p1', variant_id: 'v1', product_code: 'PROD1', variant_code: 'VAR1', 
          product_name: 'Product 1', variant_name: 'Variant 1', qty: 3000, units_per_case: 20 },
        { product_id: 'p2', variant_id: 'v2', product_code: 'PROD2', variant_code: 'VAR2',
          product_name: 'Product 2', variant_name: 'Variant 2', qty: 3000, units_per_case: 20 },
        { product_id: 'p3', variant_id: 'v3', product_code: 'PROD3', variant_code: 'VAR3',
          product_name: 'Product 3', variant_name: 'Variant 3', qty: 3000, units_per_case: 20 },
        { product_id: 'p4', variant_id: 'v4', product_code: 'PROD4', variant_code: 'VAR4',
          product_name: 'Product 4', variant_name: 'Variant 4', qty: 3000, units_per_case: 20 },
        { product_id: 'p5', variant_id: 'v5', product_code: 'PROD5', variant_code: 'VAR5',
          product_name: 'Product 5', variant_name: 'Variant 5', qty: 3000, units_per_case: 20 },
        { product_id: 'p6', variant_id: 'v6', product_code: 'PROD6', variant_code: 'VAR6',
          product_name: 'Product 6', variant_name: 'Variant 6', qty: 3000, units_per_case: 20 },
        { product_id: 'p7', variant_id: 'v7', product_code: 'PROD7', variant_code: 'VAR7',
          product_name: 'Product 7', variant_name: 'Variant 7', qty: 3000, units_per_case: 20 },
      ],
      bufferPercent: 5,
      unitsPerCase: 20,
      useIndividualCaseSizes: true
    }

    beforeAll(() => {
      result = generateQRBatch(params)
    })

    test('generates correct totals for 7 variants', () => {
      expect(result.totalBaseUnits).toBe(21000) // 7 × 3000
      expect(result.totalUniqueCodes).toBe(22050) // 21000 + 1050 buffer (5%)
      
      const productionCodes = result.individualCodes.filter(c => !c.is_buffer)
      const bufferCodes = result.individualCodes.filter(c => c.is_buffer)
      
      expect(productionCodes.length).toBe(21000)
      expect(bufferCodes.length).toBe(1050) // 7 × 150
    })

    test('each variant has correct production and buffer counts', () => {
      const variantGroups = new Map<string, { production: number; buffer: number }>()
      
      result.individualCodes.forEach(code => {
        const key = `${code.product_code}-${code.variant_code}`
        if (!variantGroups.has(key)) {
          variantGroups.set(key, { production: 0, buffer: 0 })
        }
        const group = variantGroups.get(key)!
        if (code.is_buffer) {
          group.buffer++
        } else {
          group.production++
        }
      })
      
      // Each variant should have 3000 production + 150 buffer
      expect(variantGroups.size).toBe(7)
      variantGroups.forEach((counts, variantKey) => {
        expect(counts.production).toBe(3000)
        expect(counts.buffer).toBe(150)
      })
    })

    test('all buffer codes across all variants have case_number = 0', () => {
      const bufferCodes = result.individualCodes.filter(c => c.is_buffer)
      
      expect(bufferCodes.length).toBe(1050)
      
      bufferCodes.forEach(code => {
        expect(code.case_number).toBe(0)
      })
    })

    test('each variant has independent case numbering 1-150', () => {
      // Group production codes by variant
      const variantCodes = new Map<string, typeof result.individualCodes>()
      
      result.individualCodes
        .filter(c => !c.is_buffer)
        .forEach(code => {
          const key = `${code.product_code}-${code.variant_code}`
          if (!variantCodes.has(key)) {
            variantCodes.set(key, [])
          }
          variantCodes.get(key)!.push(code)
        })
      
      // Each variant should have case numbers 1-150
      variantCodes.forEach((codes, variantKey) => {
        const caseNumbers = new Set(codes.map(c => c.case_number))
        
        expect(caseNumbers.size).toBe(150)
        expect(Math.min(...Array.from(caseNumbers))).toBe(1)
        expect(Math.max(...Array.from(caseNumbers))).toBe(150)
        
        // Check all 1-150 present
        for (let i = 1; i <= 150; i++) {
          expect(caseNumbers.has(i)).toBe(true)
        }
      })
    })
  })

  describe('Excel Generation - Case Number Column', () => {
    test('Excel shows null/empty for buffer codes', async () => {
      const params: QRCodeGenerationParams = {
        orderNo: 'ORD-TEST-2024-03',
        manufacturerCode: 'MFG-001',
        orderItems: [
          {
            product_id: 'prod-001',
            variant_id: 'var-001',
            product_code: 'TEST001',
            variant_code: 'FLAVOR1',
            product_name: 'Test Product',
            variant_name: 'Flavor 1',
            qty: 100,
            units_per_case: 20
          }
        ],
        bufferPercent: 5,
        unitsPerCase: 20,
        useIndividualCaseSizes: true
      }

      const batch = generateQRBatch(params)
      
      const excelData: QRExcelData = {
        orderNo: params.orderNo,
        orderDate: new Date().toISOString(),
        companyName: 'Test Company',
        manufacturerName: 'Test Manufacturer',
        masterCodes: batch.masterCodes,
        individualCodes: batch.individualCodes,
        totalMasterCodes: batch.totalMasterCodes,
        totalUniqueCodes: batch.totalUniqueCodes,
        totalBaseUnits: batch.totalBaseUnits,
        bufferPercent: params.bufferPercent,
        extraQrMaster: 0
      }

      const excelPath = await generateQRExcel(excelData)
      
      try {
        // Read and verify the Excel file
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(excelPath)
        
        const sheet = workbook.getWorksheet('Individual QR Codes')
        expect(sheet).toBeDefined()
        
        let productionWithCaseNumbers = 0
        let bufferWithNullCaseNumbers = 0
        let bufferWithPositiveCaseNumbers = 0
        
        // Skip header row, start from row 2
        sheet!.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return // Skip header
          
          const caseNumber = row.getCell(8).value // Column H
          const isBuffer = row.getCell(9).value // Column I
          
          if (isBuffer === 'TRUE') {
            if (caseNumber === null || caseNumber === '') {
              bufferWithNullCaseNumbers++
            } else if (typeof caseNumber === 'number' && caseNumber > 0) {
              bufferWithPositiveCaseNumbers++
            }
          } else if (isBuffer === 'FALSE') {
            if (typeof caseNumber === 'number' && caseNumber > 0) {
              productionWithCaseNumbers++
            }
          }
        })
        
        // Production codes: 100 with case numbers
        expect(productionWithCaseNumbers).toBe(100)
        
        // Buffer codes: 5 (5% of 100) with null case numbers
        expect(bufferWithNullCaseNumbers).toBe(5)
        expect(bufferWithPositiveCaseNumbers).toBe(0)
        
      } finally {
        // Cleanup
        await unlink(excelPath).catch(() => {})
      }
    })

    test('Excel case numbers match per-variant calculation', async () => {
      const params: QRCodeGenerationParams = {
        orderNo: 'ORD-TEST-2024-04',
        manufacturerCode: 'MFG-001',
        orderItems: [
          {
            product_id: 'prod-001',
            variant_id: 'var-001',
            product_code: 'TEST001',
            variant_code: 'FLAVOR1',
            product_name: 'Test Product',
            variant_name: 'Flavor 1',
            qty: 60,
            units_per_case: 20
          }
        ],
        bufferPercent: 0, // No buffer for simpler testing
        unitsPerCase: 20,
        useIndividualCaseSizes: true
      }

      const batch = generateQRBatch(params)
      
      const excelData: QRExcelData = {
        orderNo: params.orderNo,
        orderDate: new Date().toISOString(),
        companyName: 'Test Company',
        manufacturerName: 'Test Manufacturer',
        masterCodes: batch.masterCodes,
        individualCodes: batch.individualCodes,
        totalMasterCodes: batch.totalMasterCodes,
        totalUniqueCodes: batch.totalUniqueCodes,
        totalBaseUnits: batch.totalBaseUnits,
        bufferPercent: params.bufferPercent,
        extraQrMaster: 10
      }

      const excelPath = await generateQRExcel(excelData)
      
      try {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(excelPath)
        
        const sheet = workbook.getWorksheet('Individual QR Codes')
        expect(sheet).toBeDefined()
        
        const caseCounts = new Map<number, number>()
        
        // Skip header row
        sheet!.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return
          
          const caseNumber = row.getCell(8).value as number
          const isBuffer = row.getCell(9).value
          
          if (isBuffer === 'FALSE' && typeof caseNumber === 'number') {
            caseCounts.set(caseNumber, (caseCounts.get(caseNumber) || 0) + 1)
          }
        })
        
        // 60 units / 20 per case = 3 cases
        expect(caseCounts.size).toBe(3)
        
        // Case 1: 20 units, Case 2: 20 units, Case 3: 20 units
        expect(caseCounts.get(1)).toBe(20)
        expect(caseCounts.get(2)).toBe(20)
        expect(caseCounts.get(3)).toBe(20)
        
      } finally {
        await unlink(excelPath).catch(() => {})
      }
    })
  })

  describe('Edge Cases', () => {
    test('handles variant with qty not divisible by case size', () => {
      const params: QRCodeGenerationParams = {
        orderNo: 'ORD-TEST-2024-05',
        manufacturerCode: 'MFG-001',
        orderItems: [
          {
            product_id: 'prod-001',
            variant_id: 'var-001',
            product_code: 'TEST001',
            variant_code: 'FLAVOR1',
            product_name: 'Test Product',
            variant_name: 'Flavor 1',
            qty: 55, // Not divisible by 20
            units_per_case: 20
          }
        ],
        bufferPercent: 0,
        unitsPerCase: 20,
        useIndividualCaseSizes: true
      }

      const result = generateQRBatch(params)
      const productionCodes = result.individualCodes.filter(c => !c.is_buffer)
      
      // 55 units / 20 per case = 3 cases (ceil)
      const caseNumbers = new Set(productionCodes.map(c => c.case_number))
      expect(caseNumbers.size).toBe(3)
      
      // Count per case
      const caseCounts = new Map<number, number>()
      productionCodes.forEach(code => {
        caseCounts.set(code.case_number, (caseCounts.get(code.case_number) || 0) + 1)
      })
      
      expect(caseCounts.get(1)).toBe(20)
      expect(caseCounts.get(2)).toBe(20)
      expect(caseCounts.get(3)).toBe(15) // Partial case
    })

    test('handles zero buffer percentage', () => {
      const params: QRCodeGenerationParams = {
        orderNo: 'ORD-TEST-2024-06',
        orderItems: [
          {
            product_id: 'prod-001',
            variant_id: 'var-001',
            product_code: 'TEST001',
            variant_code: 'FLAVOR1',
            product_name: 'Test Product',
            variant_name: 'Flavor 1',
            qty: 100,
            units_per_case: 20
          }
        ],
        bufferPercent: 0,
        unitsPerCase: 20,
        useIndividualCaseSizes: true
      }

      const result = generateQRBatch(params)
      
      expect(result.totalUniqueCodes).toBe(100)
      expect(result.individualCodes.filter(c => c.is_buffer).length).toBe(0)
      expect(result.individualCodes.filter(c => !c.is_buffer).length).toBe(100)
    })
  })
})
