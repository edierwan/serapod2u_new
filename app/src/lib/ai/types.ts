/**
 * AI Gateway – shared types for all AI providers and HR assistant
 */

// ─── Provider Config ───────────────────────────────────────────────

export type AiProvider = 'openclaw' | 'moltbot' | 'ollama'

export interface AiProviderConfig {
  provider: AiProvider
  baseUrl: string
  token: string
  enabled: boolean
  /** Ollama-specific: model name (e.g. 'qwen2.5:3b-instruct') */
  model?: string
}

// ─── Normalized AI Response ────────────────────────────────────────

export interface AiCitation {
  title: string
  key: string
}

export interface AiSuggestedAction {
  key: string
  label: string
  confirm_required: boolean
  payload?: Record<string, unknown>
}

export interface AiResponse {
  provider: AiProvider
  message: string
  citations?: AiCitation[]
  suggested_actions?: AiSuggestedAction[]
  error?: string
}

// ─── Chat Request / Response ───────────────────────────────────────

export interface AiChatRequest {
  message: string
  context?: {
    page?: string
    orgId?: string
    auditSummary?: HrAuditSummary
    /** Compact counts for the AI – never PII */
    counts?: Record<string, number | boolean | string>
  }
  provider?: AiProvider
  systemInstruction?: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ─── HR Audit ──────────────────────────────────────────────────────

export type AuditStatus = 'configured' | 'partial' | 'missing'

export interface AuditCheck {
  key: string
  label: string
  status: AuditStatus
  detail: string
  fix_key?: string
}

export interface AuditSection {
  key: string
  label: string
  status: AuditStatus
  checks: AuditCheck[]
}

export interface HrAuditSummary {
  total: number
  configured: number
  partial: number
  missing: number
}

export interface HrAuditResult {
  orgId: string
  generatedAt: string
  summary: HrAuditSummary
  sections: AuditSection[]
}

// ─── Fix Action ────────────────────────────────────────────────────

export interface FixActionRequest {
  actionKey: string
  orgId: string
  confirmation: boolean
  payload?: Record<string, unknown>
}

export interface FixActionResult {
  success: boolean
  actionKey: string
  message: string
  changes?: string[]
  nextSteps?: string[]
}
