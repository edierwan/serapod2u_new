import { describe, expect, it } from 'vitest'
import { createClassicSignatureFooterLayout } from '@/lib/pdf-templates'

describe('createClassicSignatureFooterLayout', () => {
  it('stacks labels above wrapped names and keeps names inside separate columns', () => {
    const widths: number[] = []
    const layout = createClassicSignatureFooterLayout(
      210,
      15,
      180,
      'Nur Hidayah Binti Salamat',
      'Muhammad Farhan Bin PAA Mohd Farok',
      (text, maxWidth) => {
        widths.push(maxWidth)
        return text.startsWith('Muhammad')
          ? ['Muhammad Farhan Bin PAA', 'Mohd Farok']
          : [text]
      }
    )

    expect(layout.creator.label).toBe('Created by:')
    expect(layout.creator.nameLines).toEqual(['Nur Hidayah Binti Salamat'])
    expect(layout.approver.label).toBe('Approved by:')
    expect(layout.approver.nameLines).toEqual(['Muhammad Farhan Bin PAA', 'Mohd Farok'])
    expect(widths).toEqual([52, 52])

    expect(layout.creator.centerX + layout.nameMaxWidth / 2)
      .toBeLessThan(layout.approver.centerX - layout.nameMaxWidth / 2)
    expect(layout.approver.centerX + layout.nameMaxWidth / 2).toBeLessThanOrEqual(195)
    expect(layout.signatureY)
      .toBeGreaterThan(layout.nameY + layout.nameLineHeight)
    expect(layout.dateY).toBeGreaterThan(layout.signatureLineY)
  })
})
