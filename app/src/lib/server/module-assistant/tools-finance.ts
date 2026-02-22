/**
 * Finance Module — Smart DB Tools
 *
 * Intent-based DB queries for GL, journals, documents, AR/AP,
 * fiscal years, budgets, and bank reconciliation.
 */
import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'

// ─── Types ─────────────────────────────────────────────────────────

export type FinToolName =
  | 'chartOfAccounts'
  | 'accountsByType'
  | 'journalSummary'
  | 'recentJournals'
  | 'pendingPostings'
  | 'documentSummary'
  | 'outstandingInvoices'
  | 'outstandingBills'
  | 'paymentSummary'
  | 'fiscalYearInfo'
  | 'trialBalance'
  | 'bankAccounts'
  | 'budgetSummary'
  | 'taxCodes'
  | 'glSettings'
  | 'arAgingSummary'
  | 'apAgingSummary'
  | 'financeSetupStatus'

export interface FinToolResult {
  success: boolean
  tool: string
  summary: string
  rows?: Record<string, any>[]
  totalCount?: number
  truncated?: boolean
  error?: string
}

const MAX_ROWS = 25

// ─── Intent Detection ──────────────────────────────────────────────

interface IntentPattern {
  tool: FinToolName
  patterns: RegExp[]
  priority: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    tool: 'financeSetupStatus',
    patterns: [
      /\b(setup|set\s*up|configure|konfigurasi|tetapkan|how\s*to\s*start|cara\s*mula|get\s*started|quick\s*start|first\s*time|baru\s*guna|mulakan|mula|start)\b.*\b(financ|kewangan|accounting|akaun|perakaunan)?\b/i,
      /\b(financ|kewangan|accounting|perakaunan)\b.*\b(setup|set\s*up|configure|ready|status|siap|sedia)\b/i,
      /\b(apa|what)\b.*\b(perlu|need|required|missing|kekurangan)\b.*\b(setup|configure|sedia|tetapan)?\b/i,
      /\b(guided?\s*setup|auto\s*setup|wizard|panduan)\b/i,
      /^(help|tolong|bantuan?|how|macam\s*mana|bagaimana)\s*\??$/i,
      /\b(belum|not\s*yet|haven't|tak|x)\b.*\b(setup|configure|sedia|start)\b/i,
    ],
    priority: 11,
  },
  {
    tool: 'chartOfAccounts',
    patterns: [
      /\b(chart\s*of\s*accounts|coa|senarai\s*akaun|list\s*accounts?|all\s*accounts?|semua\s*akaun)\b/i,
      /\b(total|jumlah|berapa|how\s*many)\b.*\b(accounts?|akaun|gl)\b/i,
      /^(gl\s*)?accounts?\s*\??$/i,
    ],
    priority: 10,
  },
  {
    tool: 'accountsByType',
    patterns: [
      /\b(asset|liability|equity|income|expense|aset|liabiliti|ekuiti|hasil|perbelanjaan)\b.*\b(account|akaun)\b/i,
      /\b(account|akaun)\b.*\b(type|jenis|category|kategori)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'journalSummary',
    patterns: [
      /\b(journal|jurnal)\b.*\b(summary|ringkasan|total|jumlah|berapa|how\s*many|stat)\b/i,
      /\b(summary|ringkasan|total|jumlah)\b.*\b(journal|jurnal)\b/i,
      /^total\s*journals?\s*\??$/i,
    ],
    priority: 9,
  },
  {
    tool: 'recentJournals',
    patterns: [
      /\b(recent|terkini|latest|baru|last|semua)\b.*\b(journal|jurnal)\b/i,
      /\b(journal|jurnal)\b.*\b(recent|terkini|latest|baru|last|senarai|list)\b/i,
      /\b(boleh|nak|show|can|senarai|list)\b.*\b(journal|jurnal)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'pendingPostings',
    patterns: [
      /\b(pending|belum|unposted|draft)\b.*\b(posting|journal|jurnal|post)\b/i,
      /\b(posting|journal|jurnal)\b.*\b(pending|belum|unposted|draft)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'documentSummary',
    patterns: [
      /\b(document|dokumen)\b.*\b(summary|ringkasan|total|stat)\b/i,
      /\b(total|jumlah|berapa|how\s*many)\b.*\b(documents?|dokumen|invoices?|bills?)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'outstandingInvoices',
    patterns: [
      /\b(outstanding|tertunggak|unpaid|belum\s*bayar|overdue)\b.*\b(invoices?|invois)\b/i,
      /\b(invoices?|invois)\b.*\b(outstanding|tertunggak|unpaid|belum\s*bayar|overdue|pending)\b/i,
      /\b(ar|receivable|hutang\s*pelanggan|piutang)\b/i,
      /^outstanding\s*invoices?\s*\??$/i,
      /\b(boleh|nak|show|berapa)\b.*\b(invoice|invois)\b/i,
      /\b(ada|any|berapa)\b.*\b(outstanding|tertunggak|unpaid|belum)\b.*\b(invoice|invois|payment|bayaran)\b/i,
    ],
    priority: 10,
  },
  {
    tool: 'outstandingBills',
    patterns: [
      /\b(outstanding|tertunggak|unpaid|belum\s*bayar|overdue)\b.*\b(bills?|bil)\b/i,
      /\b(bills?|bil)\b.*\b(outstanding|tertunggak|unpaid|belum\s*bayar|overdue|pending)\b/i,
      /\b(ap|payable|hutang\s*(pembekal|vendor|supplier))\b/i,
      /^outstanding\s*bills?\s*\??$/i,
    ],
    priority: 10,
  },
  {
    tool: 'paymentSummary',
    patterns: [
      /\b(payment|bayaran|pembayaran)\b.*\b(summary|ringkasan|total|stat)\b/i,
      /\b(summary|total|jumlah)\b.*\b(payment|bayaran)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'fiscalYearInfo',
    patterns: [
      /\b(fiscal|fiskal|tahun\s*kewangan)\b.*\b(year|tahun|period|tempoh)\b/i,
      /\b(year|tahun|period|tempoh)\b.*\b(fiscal|fiskal|kewangan|accounting)\b/i,
      /^fiscal\s*(year|period)s?\s*\??$/i,
    ],
    priority: 8,
  },
  {
    tool: 'trialBalance',
    patterns: [
      /\b(trial\s*balance|imbangan\s*duga|tb)\b/i,
      /\b(balance\s*sheet|penyata\s*imbangan|kunci\s*kira-kira)\b/i,
      /\b(profit|loss|untung|rugi|income\s*statement|penyata\s*pendapatan)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'bankAccounts',
    patterns: [
      /\b(bank\s*account|akaun\s*bank)\b/i,
      /\b(senarai|list|berapa|how\s*many)\b.*\b(bank)\b/i,
      /\b(reconcil|penyesuaian)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'budgetSummary',
    patterns: [
      /\b(budget|bajet)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'taxCodes',
    patterns: [
      /\b(tax|cukai|gst|sst)\b.*\b(code|kod|rate|kadar)\b/i,
      /\b(code|kod)\b.*\b(tax|cukai)\b/i,
      /\b(berapa|what|how\s*much)\b.*\b(tax|cukai|gst|sst)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'glSettings',
    patterns: [
      /\b(gl|accounting|perakaunan)\b.*\b(setting|tetapan|config)\b/i,
    ],
    priority: 6,
  },
  {
    tool: 'arAgingSummary',
    patterns: [
      /\b(ar|receivable)\b.*\b(aging|ageing|umur)\b/i,
      /\b(aging|ageing|umur)\b.*\b(ar|receivable|piutang|hutang\s*pelanggan)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'apAgingSummary',
    patterns: [
      /\b(ap|payable)\b.*\b(aging|ageing|umur)\b/i,
      /\b(aging|ageing|umur)\b.*\b(ap|payable|hutang\s*pembekal)\b/i,
    ],
    priority: 9,
  },
]

export function detectFinIntent(message: string): { tool: FinToolName | null; confidence: 'high' | 'medium' } {
  const lower = message.toLowerCase()
  let bestMatch: { tool: FinToolName; priority: number } | null = null
  for (const ip of INTENT_PATTERNS) {
    for (const p of ip.patterns) {
      if (p.test(lower)) {
        if (!bestMatch || ip.priority > bestMatch.priority) {
          bestMatch = { tool: ip.tool, priority: ip.priority }
        }
        break
      }
    }
  }
  return bestMatch
    ? { tool: bestMatch.tool, confidence: bestMatch.priority >= 8 ? 'high' : 'medium' }
    : { tool: null, confidence: 'medium' }
}

// ─── Tool Executor ─────────────────────────────────────────────────

export async function executeFinTool(
  toolName: FinToolName,
  supabase: SupabaseClient,
  orgId: string,
): Promise<FinToolResult> {
  try {
    switch (toolName) {
      case 'chartOfAccounts': return await chartOfAccounts(supabase, orgId)
      case 'accountsByType': return await accountsByType(supabase, orgId)
      case 'journalSummary': return await journalSummary(supabase, orgId)
      case 'recentJournals': return await recentJournals(supabase, orgId)
      case 'pendingPostings': return await pendingPostings(supabase, orgId)
      case 'documentSummary': return await documentSummary(supabase, orgId)
      case 'outstandingInvoices': return await outstandingInvoices(supabase, orgId)
      case 'outstandingBills': return await outstandingBills(supabase, orgId)
      case 'paymentSummary': return await paymentSummary(supabase, orgId)
      case 'fiscalYearInfo': return await fiscalYearInfo(supabase, orgId)
      case 'trialBalance': return await trialBalanceSummary(supabase, orgId)
      case 'bankAccounts': return await bankAccountList(supabase, orgId)
      case 'budgetSummary': return await budgetSummary(supabase, orgId)
      case 'taxCodes': return await taxCodesList(supabase, orgId)
      case 'glSettings': return await glSettingsInfo(supabase, orgId)
      case 'arAgingSummary': return await outstandingInvoices(supabase, orgId)
      case 'apAgingSummary': return await outstandingBills(supabase, orgId)
      case 'financeSetupStatus': return await financeSetupStatus(supabase, orgId)
      default: return { success: false, tool: toolName, summary: 'Unknown tool' }
    }
  } catch (err: any) {
    console.error(`[Fin Tool ${toolName}] Error:`, err.message)
    return { success: false, tool: toolName, summary: `Error: ${err.message}`, error: err.message }
  }
}

// ─── Tool Implementations ──────────────────────────────────────────

async function chartOfAccounts(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('gl_accounts')
    .select('id, account_code, account_name, account_type, is_active', { count: 'exact' })
    .eq('company_id', orgId)
    .order('account_code')
    .limit(MAX_ROWS)

  const byType: Record<string, number> = {}
  let activeCount = 0
  for (const a of (data ?? [])) {
    byType[a.account_type] = (byType[a.account_type] || 0) + 1
    if (a.is_active) activeCount++
  }

  return {
    success: true,
    tool: 'chartOfAccounts',
    summary: `📊 **Chart of Accounts** (${count ?? 0} total, ${activeCount} active):\n${Object.entries(byType).map(([t, c]) => `- ${t}: **${c}**`).join('\n')}`,
    rows: data ?? [],
    totalCount: count ?? 0,
    truncated: (count ?? 0) > MAX_ROWS,
  }
}

async function accountsByType(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const types = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']
  const rows: any[] = []

  for (const t of types) {
    const { count } = await supabase
      .from('gl_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', orgId)
      .eq('account_type', t)
      .eq('is_active', true)
    rows.push({ type: t, count: count ?? 0 })
  }

  return {
    success: true,
    tool: 'accountsByType',
    summary: `📊 **GL Accounts by Type:**\n${rows.map(r => `- ${r.type}: **${r.count}** active`).join('\n')}`,
    rows,
  }
}

async function journalSummary(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { count: total } = await supabase.from('gl_journals').select('id', { count: 'exact', head: true }).eq('company_id', orgId)
  const { count: posted } = await supabase.from('gl_journals').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('status', 'posted')
  const { count: draft } = await supabase.from('gl_journals').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('status', 'draft')
  const { count: reversed } = await supabase.from('gl_journals').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('status', 'reversed')

  return {
    success: true,
    tool: 'journalSummary',
    summary: `📋 **Journal Summary:**\n- Total: **${total ?? 0}**\n- Posted: **${posted ?? 0}**\n- Draft: **${draft ?? 0}**\n- Reversed: **${reversed ?? 0}**`,
    totalCount: total ?? 0,
  }
}

async function recentJournals(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('gl_journals')
    .select('id, journal_number, description, status, total_debit, journal_date', { count: 'exact' })
    .eq('company_id', orgId)
    .order('journal_date', { ascending: false })
    .limit(10)

  const rows = (data ?? []).map((j: any) => ({
    journal_no: j.journal_number,
    description: (j.description ?? '').slice(0, 60),
    status: j.status,
    amount: j.total_debit,
    date: j.journal_date,
  }))

  return {
    success: true,
    tool: 'recentJournals',
    summary: `📋 **Recent Journals** (${count ?? 0} total):\n${rows.map(r => `- **${r.journal_no}** — ${r.description} [${r.status}] RM${r.amount ?? 0} (${r.date})`).join('\n')}`,
    rows,
    totalCount: count ?? 0,
  }
}

async function pendingPostings(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('gl_journals')
    .select('id, journal_number, description, total_debit, journal_date', { count: 'exact' })
    .eq('company_id', orgId)
    .eq('status', 'draft')
    .order('journal_date', { ascending: false })
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'pendingPostings',
    summary: `⏳ **Pending Postings** (${count ?? 0} draft journals):\n${(data ?? []).slice(0, 10).map((j: any) => `- **${j.journal_number}** — ${(j.description ?? '').slice(0, 50)} RM${j.total_debit ?? 0}`).join('\n') || 'No pending journals'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function documentSummary(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const types = ['INVOICE', 'PAYMENT', 'RECEIPT', 'PAYMENT_REQUEST', 'PO']
  const rows: any[] = []

  for (const dt of types) {
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', orgId)
      .eq('doc_type', dt)
    rows.push({ type: dt, count: count ?? 0 })
  }

  const { count: total } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', orgId)
  const { count: pending } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('status', 'pending')

  return {
    success: true,
    tool: 'documentSummary',
    summary: `📄 **Document Summary** (${total ?? 0} total, ${pending ?? 0} pending):\n${rows.map(r => `- ${r.type}: **${r.count}**`).join('\n')}`,
    rows,
    totalCount: total ?? 0,
  }
}

async function outstandingInvoices(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('documents')
    .select('id, doc_number, status, total_amount, created_at, issued_to_org_id', { count: 'exact' })
    .eq('company_id', orgId)
    .eq('doc_type', 'INVOICE')
    .in('status', ['pending', 'acknowledged'])
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  const totalAmt = (data ?? []).reduce((s: number, d: any) => s + (d.total_amount || 0), 0)

  return {
    success: true,
    tool: 'outstandingInvoices',
    summary: `📊 **Outstanding Invoices** (${count ?? 0}):\n- Total Amount: **RM ${totalAmt.toLocaleString()}**\n${(data ?? []).slice(0, 10).map((d: any) => `- **${d.doc_number}** — RM${d.total_amount ?? 0} [${d.status}]`).join('\n') || 'No outstanding invoices'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
    truncated: (count ?? 0) > MAX_ROWS,
  }
}

async function outstandingBills(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('documents')
    .select('id, doc_number, status, total_amount, created_at, issued_by_org_id', { count: 'exact' })
    .eq('company_id', orgId)
    .in('doc_type', ['PAYMENT_REQUEST', 'PO'])
    .in('status', ['pending', 'acknowledged'])
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  const totalAmt = (data ?? []).reduce((s: number, d: any) => s + (d.total_amount || 0), 0)

  return {
    success: true,
    tool: 'outstandingBills',
    summary: `📊 **Outstanding Bills/AP** (${count ?? 0}):\n- Total Amount: **RM ${totalAmt.toLocaleString()}**\n${(data ?? []).slice(0, 10).map((d: any) => `- **${d.doc_number}** — RM${d.total_amount ?? 0} [${d.status}]`).join('\n') || 'No outstanding bills'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function paymentSummary(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('documents')
    .select('id, doc_number, status, total_amount, created_at', { count: 'exact' })
    .eq('company_id', orgId)
    .eq('doc_type', 'PAYMENT')
    .order('created_at', { ascending: false })
    .limit(10)

  const totalAmt = (data ?? []).reduce((s: number, d: any) => s + (d.total_amount || 0), 0)

  return {
    success: true,
    tool: 'paymentSummary',
    summary: `💳 **Payment Summary** (${count ?? 0} payments, RM ${totalAmt.toLocaleString()}):\n${(data ?? []).map((d: any) => `- **${d.doc_number}** — RM${d.total_amount ?? 0} [${d.status}] ${d.created_at?.split('T')[0]}`).join('\n') || 'No payments found'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function fiscalYearInfo(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data: years } = await supabase
    .from('fiscal_years')
    .select('id, year_name, start_date, end_date, status')
    .eq('company_id', orgId)
    .order('start_date', { ascending: false })
    .limit(5)

  const { count: periods } = await supabase.from('fiscal_periods').select('id', { count: 'exact', head: true }).eq('company_id', orgId)

  return {
    success: true,
    tool: 'fiscalYearInfo',
    summary: `📅 **Fiscal Years** (${(years ?? []).length} found, ${periods ?? 0} periods):\n${(years ?? []).map((y: any) => `- **${y.year_name}** — ${y.start_date} to ${y.end_date} [${y.status}]`).join('\n') || 'No fiscal years configured'}`,
    rows: years ?? [],
  }
}

async function trialBalanceSummary(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  // Get posted journal totals by account type
  const { data: journals } = await supabase
    .from('gl_journals')
    .select('total_debit, total_credit')
    .eq('company_id', orgId)
    .eq('status', 'posted')
    .limit(10000)

  let totalDebit = 0, totalCredit = 0
  for (const j of (journals ?? [])) {
    totalDebit += j.total_debit || 0
    totalCredit += j.total_credit || 0
  }

  return {
    success: true,
    tool: 'trialBalance',
    summary: `📊 **Trial Balance Summary:**\n- Total Debits: **RM ${totalDebit.toLocaleString()}**\n- Total Credits: **RM ${totalCredit.toLocaleString()}**\n- Balanced: **${Math.abs(totalDebit - totalCredit) < 0.01 ? 'Yes ✅' : 'No ⚠️ (diff: RM ' + Math.abs(totalDebit - totalCredit).toFixed(2) + ')'}**\n\n_For detailed trial balance, visit Finance > Reports > Trial Balance._`,
  }
}

async function bankAccountList(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('bank_accounts')
    .select('id, account_name, bank_name, account_number, currency_code, is_active', { count: 'exact' })
    .eq('company_id', orgId)
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'bankAccounts',
    summary: `🏦 **Bank Accounts** (${count ?? 0}):\n${(data ?? []).map((b: any) => `- **${b.account_name}** — ${b.bank_name} (${b.account_number}) [${b.is_active ? 'Active' : 'Inactive'}]`).join('\n') || 'No bank accounts configured'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function budgetSummary(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('gl_budgets')
    .select('id, budget_name, fiscal_year_id, status', { count: 'exact' })
    .eq('company_id', orgId)
    .limit(10)

  return {
    success: true,
    tool: 'budgetSummary',
    summary: `📋 **Budgets** (${count ?? 0}):\n${(data ?? []).map((b: any) => `- **${b.budget_name}** [${b.status}]`).join('\n') || 'No budgets configured'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function taxCodesList(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data, count } = await supabase
    .from('tax_codes')
    .select('id, code, name, rate, is_active', { count: 'exact' })
    .eq('company_id', orgId)
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'taxCodes',
    summary: `📊 **Tax Codes** (${count ?? 0}):\n${(data ?? []).map((t: any) => `- **${t.code}** — ${t.name} (${t.rate}%) [${t.is_active ? 'Active' : 'Inactive'}]`).join('\n') || 'No tax codes configured'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function glSettingsInfo(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  const { data } = await supabase
    .from('gl_settings')
    .select('*')
    .eq('company_id', orgId)
    .single()

  if (!data) {
    return { success: true, tool: 'glSettings', summary: '⚠️ GL Settings not configured yet. Visit Finance > Settings to set up.' }
  }

  return {
    success: true,
    tool: 'glSettings',
    summary: `⚙️ **GL Settings:**\n- Posting Mode: **${data.posting_mode ?? 'N/A'}**\n- AR Control: ${data.ar_control_account_id ? '✅ Set' : '❌ Not set'}\n- AP Control: ${data.ap_control_account_id ? '✅ Set' : '❌ Not set'}\n- Cash Account: ${data.cash_account_id ? '✅ Set' : '❌ Not set'}\n- Sales Revenue: ${data.sales_revenue_account_id ? '✅ Set' : '❌ Not set'}\n- COGS: ${data.cogs_account_id ? '✅ Set' : '❌ Not set'}\n- Inventory: ${data.inventory_account_id ? '✅ Set' : '❌ Not set'}`,
    rows: [data],
  }
}

// ─── Finance Setup Status (First-Timer Guidance) ──────────────────

async function financeSetupStatus(supabase: SupabaseClient, orgId: string): Promise<FinToolResult> {
  // Run parallel checks for all critical finance setup items
  const [
    currRes, fyRes, coaRes, taxRes, bankRes, glRes, rulesRes,
  ] = await Promise.all([
    supabase.from('currencies').select('code', { count: 'exact', head: true }).eq('company_id', orgId),
    supabase.from('fiscal_years').select('id', { count: 'exact', head: true }).eq('company_id', orgId),
    supabase.from('gl_accounts').select('id', { count: 'exact', head: true }).eq('company_id', orgId),
    supabase.from('tax_codes').select('id', { count: 'exact', head: true }).eq('company_id', orgId),
    supabase.from('bank_accounts').select('id', { count: 'exact', head: true }).eq('company_id', orgId),
    supabase.from('gl_settings').select('posting_mode, ar_control_account_id, ap_control_account_id, cash_account_id, sales_revenue_account_id').eq('company_id', orgId).maybeSingle(),
    supabase.from('posting_rules').select('id', { count: 'exact', head: true }).eq('company_id', orgId),
  ])

  const checks = [
    { label: 'Base Currency', done: (currRes.count ?? 0) > 0, tip: 'Set your base currency (e.g. MYR) in Finance > Settings.' },
    { label: 'Fiscal Year', done: (fyRes.count ?? 0) > 0, tip: 'Create a fiscal year for your accounting periods.' },
    { label: 'Chart of Accounts', done: (coaRes.count ?? 0) > 0, tip: 'Seed your chart of accounts — use the starter template or a full COA.' },
    { label: 'Tax Codes', done: (taxRes.count ?? 0) > 0, tip: 'Add SST/GST tax codes for invoicing.' },
    { label: 'Bank Account', done: (bankRes.count ?? 0) > 0, tip: 'Add your company bank account.' },
    { label: 'GL Control Accounts', done: !!(glRes.data?.ar_control_account_id && glRes.data?.ap_control_account_id && glRes.data?.cash_account_id), tip: 'Map AR, AP, Cash, and Revenue control accounts under GL Settings.' },
    { label: 'Posting Rules', done: (rulesRes.count ?? 0) > 0, tip: 'Set auto-posting rules for invoices, payments, receipts.' },
  ]

  const done = checks.filter(c => c.done).length
  const total = checks.length
  const pct = Math.round((done / total) * 100)

  const statusEmoji = pct === 100 ? '✅' : pct >= 50 ? '🔶' : '🔴'
  const incomplete = checks.filter(c => !c.done)

  let summary = `${statusEmoji} **Finance Setup — ${pct}% Complete** (${done}/${total})\n\n`

  if (pct === 100) {
    summary += '🎉 All configuration steps are complete! Your finance module is ready to use.\n\n'
    summary += '**Quick tips:**\n'
    summary += '- Try creating your first invoice under Finance > Sales > Invoice\n'
    summary += '- Run a trial balance to verify your opening balances\n'
    summary += '- Set up budgets for expense tracking'
  } else {
    summary += '**Still needed:**\n'
    for (const c of incomplete) {
      summary += `- ❌ **${c.label}** — ${c.tip}\n`
    }
    summary += '\n'
    summary += '**Completed:**\n'
    for (const c of checks.filter(c => c.done)) {
      summary += `- ✅ ${c.label}\n`
    }
    summary += '\n💡 **Tip:** Go to **Finance > Settings** and click **"Quick Setup — Apply All Defaults"** to auto-configure everything at once!'
  }

  return {
    success: true,
    tool: 'financeSetupStatus',
    summary,
    rows: checks.map(c => ({ item: c.label, configured: c.done })),
    totalCount: total,
  }
}

// ─── Suggestions ───────────────────────────────────────────────────

export const FIN_SUGGESTIONS = [
  { label: 'How to start setup?', intent: 'financeSetupStatus' },
  { label: 'Chart of accounts?', intent: 'chartOfAccounts' },
  { label: 'Pending journals?', intent: 'pendingPostings' },
  { label: 'Outstanding invoices?', intent: 'outstandingInvoices' },
  { label: 'Trial balance?', intent: 'trialBalance' },
  { label: 'Fiscal year info?', intent: 'fiscalYearInfo' },
  { label: 'GL settings?', intent: 'glSettings' },
  { label: 'Tax codes?', intent: 'taxCodes' },
]
