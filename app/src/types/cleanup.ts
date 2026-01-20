/**
 * Types for Code Cleanup Feature
 * Supports static analysis reports, runtime usage tracking, and cleanup planning
 */

// =============================================================================
// Static Analysis Types
// =============================================================================

export interface StaticReportSummary {
  unusedFilesCount: number
  unusedExportsCount: number
  unusedDepsCount: number
  tsErrorsCount: number
  eslintWarningsCount: number
}

export interface UnusedExport {
  file: string
  exportName: string
  type: 'function' | 'variable' | 'type' | 'class' | 'interface' | 'enum' | 'unknown'
}

export interface StaticReport {
  generated_at: string
  repo_sha: string | null
  environment: 'local' | 'ci' | 'production'
  summary: StaticReportSummary
  unused_files: string[]
  unused_exports: UnusedExport[]
  unused_deps: string[]
  ts_errors: TypeScriptError[]
  eslint_warnings: ESLintWarning[]
  notes: string[]
}

export interface TypeScriptError {
  file: string
  line: number
  column: number
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface ESLintWarning {
  file: string
  line: number
  column: number
  rule: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

// Confidence levels for cleanup candidates
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface AnalysisItem {
  path: string
  name?: string
  category: 'file' | 'export' | 'dependency'
  confidence: ConfidenceLevel
  reason: string
  lastSeen?: string | null
  usageCount?: number
}

// =============================================================================
// Runtime Usage Types
// =============================================================================

export interface RuntimeUsageEvent {
  id?: string
  route: string
  method: string
  user_role: string
  org_id: string | null
  status_code: number
  timestamp: string
  response_time_ms?: number
}

export interface RouteUsageStats {
  route: string
  method: string
  hit_count: number
  last_seen: string
  first_seen: string
  avg_response_time_ms: number | null
  error_count: number
  unique_users: number
}

export interface RPCUsageStats {
  rpc_name: string
  hit_count: number
  last_seen: string
  first_seen: string
  caller_routes: string[]
}

export interface PageUsageStats {
  page_path: string
  hit_count: number
  last_seen: string
  unique_sessions: number
}

export interface RuntimeReport {
  generated_at: string
  range_days: number
  api_routes: RouteUsageStats[]
  rpc_calls: RPCUsageStats[]
  page_views: PageUsageStats[]
  total_api_calls: number
  total_rpc_calls: number
  total_page_views: number
}

// =============================================================================
// Cleanup Plan Types
// =============================================================================

export type CleanupBucket = 'safe_to_remove' | 'deprecate_first' | 'keep_or_ignore'

export interface CleanupCandidate {
  id: string
  item: AnalysisItem
  bucket: CleanupBucket
  staticEvidence: string
  runtimeEvidence: string | null
  suggestedAction: string
  deprecationDate?: string
}

export interface CleanupPlan {
  generated_at: string
  safe_to_remove: CleanupCandidate[]
  deprecate_first: CleanupCandidate[]
  keep_or_ignore: CleanupCandidate[]
  summary: {
    total_candidates: number
    safe_count: number
    deprecate_count: number
    keep_count: number
  }
}

// =============================================================================
// Export Report Types
// =============================================================================

export interface CleanupExportReport {
  generated_at: string
  environment: string
  repo_sha: string | null
  static_report: StaticReport | null
  runtime_report: RuntimeReport | null
  cleanup_plan: CleanupPlan | null
  metadata: {
    generated_by: string
    tool_version: string
    notes: string[]
  }
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface GenerateStaticReportRequest {
  include_knip?: boolean
  include_tsc?: boolean
  include_eslint?: boolean
}

export interface GenerateStaticReportResponse {
  success: boolean
  report?: StaticReport
  error?: string
  execution_time_ms?: number
}

export interface RuntimeReportRequest {
  range_days?: number
}

export interface RuntimeReportResponse {
  success: boolean
  report?: RuntimeReport
  error?: string
}

export interface ExportReportRequest {
  include_static?: boolean
  include_runtime?: boolean
  include_plan?: boolean
  format?: 'json' | 'markdown' | 'both'
}

export interface ExportReportResponse {
  success: boolean
  json_content?: string
  markdown_content?: string
  error?: string
}

// =============================================================================
// Ignore Rule Types
// =============================================================================

export interface IgnoreRule {
  pattern: string
  type: 'file' | 'export' | 'dependency'
  reason: string
  added_at: string
  added_by: string
}

export interface IgnoreRuleSuggestion {
  config_file: string
  snippet: string
  description: string
}

// =============================================================================
// UI State Types
// =============================================================================

export interface CleanupTabState {
  activeSection: 'static' | 'runtime' | 'plan' | 'export'
  staticReport: StaticReport | null
  runtimeReport: RuntimeReport | null
  cleanupPlan: CleanupPlan | null
  isGeneratingStatic: boolean
  isGeneratingRuntime: boolean
  isGeneratingPlan: boolean
  isExporting: boolean
  filters: {
    category: 'all' | 'file' | 'export' | 'dependency'
    confidence: 'all' | 'high' | 'medium' | 'low'
    search: string
  }
}

// =============================================================================
// Known False Positives (for Low Confidence)
// =============================================================================

export const KNOWN_FALSE_POSITIVES = [
  // Next.js dynamic routes and pages
  'page.tsx',
  'layout.tsx',
  'loading.tsx',
  'error.tsx',
  'not-found.tsx',
  'route.ts',
  // Next.js config
  'next.config.js',
  'next.config.mjs',
  // Middleware
  'middleware.ts',
  // Environment
  '.env',
  '.env.local',
  // Dynamic imports
  'dynamic',
  // Supabase types (auto-generated)
  'database.types.ts',
  'database.ts',
] as const

export const DYNAMIC_ROUTE_PATTERNS = [
  /\[.*\]/, // Dynamic route segments
  /api\//, // API routes
  /app\/.*\/page\.tsx$/, // Page components
] as const
