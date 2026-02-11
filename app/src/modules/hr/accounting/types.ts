// ── Types ────────────────────────────────────────────────────────

export interface HrGlMapping {
  id: string
  organization_id: string
  document_type: string
  mapping_key: string | null
  expense_account_id: string | null
  offset_account_id: string | null
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface GlAccountOption {
  id: string
  code: string
  name: string
  account_type: string
  subtype: string | null
  is_active: boolean
}

export interface HrAccountingConfig {
  mappings: HrGlMapping[]
  accounts: GlAccountOption[]
  hasCoaTemplate: boolean
}

// ── Mapping key definitions (display labels) ─────────────────────

export const PAYROLL_MAPPING_KEYS = [
  { key: 'salary_expense',           label: 'Salaries & Wages Expense',         side: 'debit',  required: true },
  { key: 'employer_contributions',   label: 'Employer Statutory Contributions', side: 'debit',  required: false },
  { key: 'payroll_payable',          label: 'Payroll Payable (Net)',            side: 'credit', required: true },
  { key: 'epf_payable',              label: 'EPF Payable',                     side: 'credit', required: true },
  { key: 'socso_payable',            label: 'SOCSO Payable',                   side: 'credit', required: true },
  { key: 'eis_payable',              label: 'EIS Payable',                     side: 'credit', required: true },
  { key: 'pcb_payable',              label: 'PCB/MTD Payable',                 side: 'credit', required: true },
  { key: 'other_deductions_payable', label: 'Other Deductions Payable',        side: 'credit', required: false },
] as const

export const CLAIMS_MAPPING_KEYS = [
  { key: 'claims_expense', label: 'Staff Claims Expense',     side: 'debit',  required: true },
  { key: 'claims_payable', label: 'Employee Claims Payable',  side: 'credit', required: true },
] as const
