import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(path.join(__dirname, 'DHReceiptDialog.tsx'), 'utf8')

describe('DH receipt attachments: private order-documents bucket', () => {
  it('uploads through the authorized order file route, never straight to Storage', () => {
    expect(source).toContain('/api/documents/order/${encodeURIComponent(orderId)}/file')
    expect(source).not.toMatch(/storage\s*\.from\(\s*['"]order-documents['"]\s*\)/)
  })

  it('keeps the receipt when the attachment fails instead of aborting the batch', () => {
    const attachmentBlock = source.slice(source.indexOf('if (receipt.attachmentFile) {'))
    expect(attachmentBlock).toMatch(/try \{[\s\S]*catch \(attachmentError/)
    expect(attachmentBlock).toContain('Receipt saved without attachment')
  })
})
