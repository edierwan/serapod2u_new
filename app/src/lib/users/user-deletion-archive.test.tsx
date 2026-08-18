import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const requestRoute = fs.readFileSync(
  path.join(root, 'src/app/api/admin/delete-user-otp/request/route.ts'),
  'utf8',
)
const verifyRoute = fs.readFileSync(
  path.join(root, 'src/app/api/admin/delete-user-otp/verify-and-delete/route.ts'),
  'utf8',
)
const managementView = fs.readFileSync(
  path.join(root, 'src/components/users/UserManagementNew.tsx'),
  'utf8',
)

describe('user deletion archive-and-release safety contract', () => {
  it('classifies retained order and document history before removal', () => {
    for (const source of [requestRoute, verifyRoute]) {
      expect(source).toContain("admin.from('orders')")
      expect(source).toContain("admin.from('documents')")
      expect(source).toContain("admin.from('document_signatures')")
      expect(source).toContain("return 'archive'")
    }
  })

  it('archives historical users and releases their reusable identifiers', () => {
    expect(verifyRoute).toContain("is_active: false")
    expect(verifyRoute).toContain("phone: null")
    expect(verifyRoute).toContain("archived-${userId}@deleted.serapod.local")
    expect(verifyRoute).toContain('admin.auth.admin.updateUserById')
    expect(verifyRoute).toContain("update({ is_active: false })")
  })

  it('explains archive behavior instead of reporting a generic failure', () => {
    expect(managementView).toContain('Users with orders or documents are archived to protect history.')
    expect(managementView).toContain('Verify & Archive')
    expect(requestRoute).not.toContain("error: 'Something went wrong'")
    expect(verifyRoute).not.toContain("error: 'Something went wrong'")
  })

  it('falls back through configured channels and keeps org contact as recipient', () => {
    expect(requestRoute).toContain("select('contact_phone, contact_email, org_name')")
    expect(requestRoute).toContain('sendTransactionalOtp')
    expect(requestRoute).toContain('resolveDeleteUserOtpPreset')
    expect(requestRoute).toContain('fallbackUsed')
    expect(managementView).toContain('User Deletion OTP')
    expect(managementView).toContain('Notifications → Types')
  })
})
