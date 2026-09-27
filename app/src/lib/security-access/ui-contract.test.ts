import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const sidebar = readFileSync(resolve(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
const view = readFileSync(resolve(root, 'src/components/security-access/SecurityAccessView.tsx'), 'utf8')
const simulator = readFileSync(resolve(root, 'src/app/api/security-access/simulate/route.ts'), 'utf8')

describe('Security & Access UI contract', () => {
  it('places the first-class entry between User Management and Settings', () => {
    expect(sidebar.indexOf('label: "User Management"')).toBeLessThan(sidebar.indexOf('label: "Security & Access"'))
    expect(sidebar.indexOf('label: "Security & Access"')).toBeLessThan(sidebar.indexOf('label: "Settings"'))
  })
  it('shows only implemented top-level sections', () => {
    for (const label of ['Overview', 'People & Access', 'Roles & Policies', 'Audit & Diagnostics']) expect(view).toContain(label)
    expect(view).not.toContain('Governance')
    expect(view).not.toContain('Technical Access')
  })
  it('uses the canonical evaluator in non-mutating explain mode', () => {
    expect(simulator).toContain("import { authorize }")
    expect(simulator).toContain('explainOnly: true')
    expect(simulator).toContain('{ log: false }')
  })
})
