/**
 * Finance Module – GL Posting Map
 *
 * Single source of truth for how business documents map to GL journal entries.
 * This is a REFERENCE file — it does NOT execute posting logic.
 * The actual posting logic lives in the Postgres RPC `post_document_to_gl()`.
 *
 * ─── Document Flow ───────────────────────────────────────────────
 *
 *   Order (ORD26000017)
 *     ├── Supplier Payment (deposit)     → SUPPLIER_DEPOSIT_PAYMENT
 *     ├── Supplier Invoice (100%)        → SUPPLIER_INVOICE_RECOGNITION
 *     ├── Supplier Payment (balance)     → SUPPLIER_BALANCE_PAYMENT
 *     ├── Sales Invoice (D2H)            → SALES_INVOICE
 *     └── Customer Receipt (D2H)         → RECEIPT
 *
 * ─── Subledger Mapping ──────────────────────────────────────────
 *
 *   AR (Accounts Receivable) ← S* documents (Sales flow, D2H orders)
 *     • SALES_INVOICE  →  Dr AR Control,      Cr Sales Revenue
 *     • RECEIPT         →  Dr Cash/Bank,       Cr AR Control
 *
 *   AP (Accounts Payable)  ← ORD* documents (Purchase flow)
 *     • SUPPLIER_DEPOSIT_PAYMENT       →  Dr Supplier Deposits, Cr Cash/Bank
 *     • SUPPLIER_INVOICE_RECOGNITION   →  Dr COGS (100%),       Cr Supplier Deposits (30%) + Cr AP (70%)
 *     • SUPPLIER_BALANCE_PAYMENT       →  Dr AP,                Cr Cash/Bank
 */

import type { LucideIcon } from 'lucide-react'
import {
  Receipt,
  CreditCard,
  FileText,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react'

// ── Posting Type Definition ─────────────────────────────────────

export interface PostingTypeInfo {
  /** Matches the gl_doc_type used in v_pending_gl_postings and post_document_to_gl */
  code: string
  /** Human-readable label */
  label: string
  /** Which subledger this belongs to */
  subledger: 'AR' | 'AP'
  /** Source document type(s) */
  sourceDocTypes: string[]
  /** Order type filter (if applicable) */
  orderType?: string
  /** Journal entries this posting creates */
  entries: { debit: string; credit: string }[]
  /** GL Settings keys for the control accounts */
  controlAccounts: string[]
  /** Accent color for UI badges */
  color: string
  /** Icon component */
  icon: LucideIcon
}

// ── All 5 Posting Types ─────────────────────────────────────────

export const POSTING_TYPES: PostingTypeInfo[] = [
  {
    code: 'SALES_INVOICE',
    label: 'Sales Invoice',
    subledger: 'AR',
    sourceDocTypes: ['INVOICE', 'SO'],
    orderType: 'D2H',
    entries: [
      { debit: 'AR Control (1200)', credit: 'Sales Revenue (4100)' },
    ],
    controlAccounts: ['ar_control_account_id', 'sales_revenue_account_id'],
    color: 'blue',
    icon: Receipt,
  },
  {
    code: 'RECEIPT',
    label: 'Customer Receipt',
    subledger: 'AR',
    sourceDocTypes: ['RECEIPT'],
    orderType: 'D2H',
    entries: [
      { debit: 'Cash/Bank (1100)', credit: 'AR Control (1200)' },
    ],
    controlAccounts: ['cash_account_id', 'ar_control_account_id'],
    color: 'green',
    icon: CreditCard,
  },
  {
    code: 'SUPPLIER_DEPOSIT_PAYMENT',
    label: 'Supplier Deposit',
    subledger: 'AP',
    sourceDocTypes: ['PAYMENT'],
    entries: [
      { debit: 'Supplier Deposits (1300)', credit: 'Cash/Bank (1100)' },
    ],
    controlAccounts: ['supplier_deposit_account_id', 'cash_account_id'],
    color: 'purple',
    icon: ArrowUpFromLine,
  },
  {
    code: 'SUPPLIER_INVOICE_RECOGNITION',
    label: 'Supplier Invoice (100%)',
    subledger: 'AP',
    sourceDocTypes: ['PAYMENT_REQUEST'],
    entries: [
      { debit: 'COGS (5100) — 100%', credit: 'Supplier Deposits (1300) — 30%' },
      { debit: '', credit: 'AP Control (2100) — 70%' },
    ],
    controlAccounts: ['cogs_account_id', 'supplier_deposit_account_id', 'ap_control_account_id'],
    color: 'indigo',
    icon: FileText,
  },
  {
    code: 'SUPPLIER_BALANCE_PAYMENT',
    label: 'Supplier Balance Payment',
    subledger: 'AP',
    sourceDocTypes: ['PAYMENT'],
    entries: [
      { debit: 'AP Control (2100)', credit: 'Cash/Bank (1100)' },
    ],
    controlAccounts: ['ap_control_account_id', 'cash_account_id'],
    color: 'orange',
    icon: Wallet,
  },
]

// ── Lookup Helpers ──────────────────────────────────────────────

/** Get posting type info by code */
export function getPostingType(code: string): PostingTypeInfo | undefined {
  return POSTING_TYPES.find((t) => t.code === code)
}

/** Get all posting types for a subledger */
export function getPostingTypesForSubledger(subledger: 'AR' | 'AP'): PostingTypeInfo[] {
  return POSTING_TYPES.filter((t) => t.subledger === subledger)
}

/** Badge color map for posting types */
export const POSTING_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  SALES_INVOICE:                { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  RECEIPT:                      { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  SUPPLIER_DEPOSIT_PAYMENT:     { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  SUPPLIER_INVOICE_RECOGNITION: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  SUPPLIER_BALANCE_PAYMENT:     { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
}

/** Journal type labels for display (matches GLJournalView constants) */
export const JOURNAL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  SALES_INVOICE:    { label: 'Sales Invoice',    color: 'blue' },
  RECEIPT:          { label: 'Receipt',           color: 'green' },
  SUPPLIER_DEPOSIT: { label: 'Supplier Deposit',  color: 'purple' },
  SUPPLIER_PAYMENT: { label: 'Supplier Payment',  color: 'orange' },
  REVERSAL:         { label: 'Reversal',           color: 'red' },
  ADJUSTMENT:       { label: 'Adjustment',         color: 'gray' },
  OPENING:          { label: 'Opening',            color: 'indigo' },
}
