import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  StaticReport,
  RuntimeReport,
  CleanupPlan,
  CleanupCandidate,
  CleanupExportReport,
  ConfidenceLevel,
  KNOWN_FALSE_POSITIVES,
  DYNAMIC_ROUTE_PATTERNS,
} from '@/types/cleanup'

export const dynamic = 'force-dynamic'

// Known false positives for confidence calculation
const FALSE_POSITIVES = [
  'page.tsx', 'layout.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx',
  'route.ts', 'next.config.js', 'middleware.ts', 'database.ts', 'database.types.ts'
]

const DYNAMIC_PATTERNS = [
  /\[.*\]/,
  /api\//,
  /app\/.*\/page\.tsx$/,
]

/**
 * POST /api/admin/cleanup/export
 * Generate and export a comprehensive cleanup report (JSON + Markdown)
 * SUPER ADMIN ONLY (role_level = 1)
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check - Super Admin only
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check role
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, email, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || (userProfile.roles as any)?.role_level !== 1) {
      return NextResponse.json({ 
        success: false, 
        error: 'Access denied. Super Admin only.' 
      }, { status: 403 })
    }

    // Parse request body
    const body = await request.json().catch(() => ({}))
    const { 
      static_report, 
      runtime_report, 
      include_plan = true,
      format = 'both' 
    } = body as {
      static_report?: StaticReport
      runtime_report?: RuntimeReport
      include_plan?: boolean
      format?: 'json' | 'markdown' | 'both'
    }

    // Generate cleanup plan if requested and we have data
    let cleanupPlan: CleanupPlan | null = null
    if (include_plan && static_report) {
      cleanupPlan = generateCleanupPlan(static_report, runtime_report || null)
    }

    // Build export report
    const exportReport: CleanupExportReport = {
      generated_at: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      repo_sha: static_report?.repo_sha || null,
      static_report: static_report || null,
      runtime_report: runtime_report || null,
      cleanup_plan: cleanupPlan,
      metadata: {
        generated_by: userProfile.email || 'unknown',
        tool_version: '1.0.0',
        notes: [
          'Reports only - no auto-deletion',
          'Apply changes via PR after engineer review',
          'Verify runtime usage before removing any code',
        ],
      },
    }

    // Generate outputs based on format
    let jsonContent: string | undefined
    let markdownContent: string | undefined

    if (format === 'json' || format === 'both') {
      jsonContent = JSON.stringify(exportReport, null, 2)
    }

    if (format === 'markdown' || format === 'both') {
      markdownContent = generateMarkdownReport(exportReport)
    }

    return NextResponse.json({
      success: true,
      json_content: jsonContent,
      markdown_content: markdownContent,
    })

  } catch (error: any) {
    console.error('Export report error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to export report',
    }, { status: 500 })
  }
}

/**
 * Generate a cleanup plan by merging static analysis with runtime data
 */
function generateCleanupPlan(
  staticReport: StaticReport,
  runtimeReport: RuntimeReport | null
): CleanupPlan {
  const candidates: CleanupCandidate[] = []
  const runtimeLastSeen = buildRuntimeLastSeenMap(runtimeReport)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Process unused files
  for (const file of staticReport.unused_files) {
    const confidence = calculateConfidence(file, 'file')
    const lastSeen = runtimeLastSeen.get(file)
    const notSeenRecently = !lastSeen || new Date(lastSeen) < thirtyDaysAgo

    candidates.push({
      id: `file-${file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      item: {
        path: file,
        category: 'file',
        confidence,
        reason: 'Not imported by any other file',
        lastSeen: lastSeen || null,
      },
      bucket: determineBucket(confidence, notSeenRecently),
      staticEvidence: 'Knip: unused file',
      runtimeEvidence: lastSeen 
        ? `Last seen: ${new Date(lastSeen).toLocaleDateString()}`
        : 'No runtime data available',
      suggestedAction: getSuggestedAction('file', confidence, notSeenRecently),
    })
  }

  // Process unused exports
  for (const exp of staticReport.unused_exports) {
    const confidence = calculateConfidence(exp.file, 'export', exp.exportName)
    const fileLastSeen = runtimeLastSeen.get(exp.file)
    const notSeenRecently = !fileLastSeen || new Date(fileLastSeen) < thirtyDaysAgo

    candidates.push({
      id: `export-${exp.file}-${exp.exportName}`.replace(/[^a-zA-Z0-9]/g, '-'),
      item: {
        path: exp.file,
        name: exp.exportName,
        category: 'export',
        confidence,
        reason: `Export "${exp.exportName}" not used`,
        lastSeen: fileLastSeen || null,
      },
      bucket: determineBucket(confidence, notSeenRecently),
      staticEvidence: `Knip: unused export "${exp.exportName}"`,
      runtimeEvidence: fileLastSeen 
        ? `File last accessed: ${new Date(fileLastSeen).toLocaleDateString()}`
        : 'No runtime data available',
      suggestedAction: getSuggestedAction('export', confidence, notSeenRecently),
    })
  }

  // Process unused dependencies
  for (const dep of staticReport.unused_deps) {
    const isDev = dep.startsWith('(dev)')
    const depName = dep.replace('(dev) ', '')
    
    candidates.push({
      id: `dep-${depName.replace(/[^a-zA-Z0-9]/g, '-')}`,
      item: {
        path: depName,
        category: 'dependency',
        confidence: 'medium', // Dependencies always medium - could be used dynamically
        reason: isDev ? 'Unused dev dependency' : 'Unused dependency',
      },
      bucket: 'deprecate_first',
      staticEvidence: `Knip: unused ${isDev ? 'dev ' : ''}dependency`,
      runtimeEvidence: 'Dependencies are not tracked at runtime',
      suggestedAction: `Remove "${depName}" from package.json ${isDev ? 'devDependencies' : 'dependencies'}`,
    })
  }

  // Sort candidates into buckets
  const safe_to_remove = candidates.filter(c => c.bucket === 'safe_to_remove')
  const deprecate_first = candidates.filter(c => c.bucket === 'deprecate_first')
  const keep_or_ignore = candidates.filter(c => c.bucket === 'keep_or_ignore')

  return {
    generated_at: new Date().toISOString(),
    safe_to_remove,
    deprecate_first,
    keep_or_ignore,
    summary: {
      total_candidates: candidates.length,
      safe_count: safe_to_remove.length,
      deprecate_count: deprecate_first.length,
      keep_count: keep_or_ignore.length,
    },
  }
}

/**
 * Calculate confidence level for a cleanup candidate
 */
function calculateConfidence(
  path: string,
  category: 'file' | 'export' | 'dependency',
  exportName?: string
): ConfidenceLevel {
  // Check against known false positives
  const fileName = path.split('/').pop() || ''
  
  if (FALSE_POSITIVES.some(fp => fileName.includes(fp) || path.includes(fp))) {
    return 'low'
  }

  // Check dynamic route patterns
  if (DYNAMIC_PATTERNS.some(pattern => pattern.test(path))) {
    return 'low'
  }

  // API routes and pages are low confidence
  if (path.includes('/api/') || path.includes('/app/')) {
    return 'medium'
  }

  // Components might be dynamically imported
  if (path.includes('/components/')) {
    return 'medium'
  }

  // Hooks and utilities are usually high confidence if unused
  if (path.includes('/hooks/') || path.includes('/utils/') || path.includes('/lib/')) {
    return 'high'
  }

  // Types are generally safe to remove if unused
  if (path.includes('/types/') || exportName?.startsWith('I') || exportName?.startsWith('T')) {
    return 'high'
  }

  return 'medium'
}

/**
 * Determine cleanup bucket based on confidence and runtime data
 */
function determineBucket(
  confidence: ConfidenceLevel,
  notSeenRecently: boolean
): CleanupCandidate['bucket'] {
  if (confidence === 'high' && notSeenRecently) {
    return 'safe_to_remove'
  }
  
  if (confidence === 'low') {
    return 'keep_or_ignore'
  }

  return 'deprecate_first'
}

/**
 * Get suggested action based on category and confidence
 */
function getSuggestedAction(
  category: 'file' | 'export' | 'dependency',
  confidence: ConfidenceLevel,
  notSeenRecently: boolean
): string {
  if (confidence === 'low') {
    return 'Keep - likely dynamic usage or framework file'
  }

  if (confidence === 'high' && notSeenRecently) {
    if (category === 'file') {
      return 'Delete file after PR review'
    }
    if (category === 'export') {
      return 'Remove export or delete if file only has this export'
    }
    return 'Remove from package.json'
  }

  // Medium confidence or seen recently
  if (category === 'file') {
    return 'Add deprecation comment and monitor for 30 days'
  }
  if (category === 'export') {
    return 'Add @deprecated JSDoc tag and monitor'
  }
  return 'Verify no dynamic imports before removing'
}

/**
 * Build a map of file paths to last seen timestamps from runtime report
 */
function buildRuntimeLastSeenMap(report: RuntimeReport | null): Map<string, string> {
  const map = new Map<string, string>()
  
  if (!report) return map

  // Map API routes
  for (const route of report.api_routes) {
    // Convert route to potential file path
    const filePath = `src/app${route.route}/route.ts`
    map.set(filePath, route.last_seen)
  }

  // Map page views
  for (const page of report.page_views) {
    const filePath = `src/app${page.page_path}/page.tsx`
    map.set(filePath, page.last_seen)
  }

  return map
}

/**
 * Generate a markdown report from the export data
 */
function generateMarkdownReport(report: CleanupExportReport): string {
  const lines: string[] = []

  lines.push('# Code Cleanup Report')
  lines.push('')
  lines.push(`**Generated:** ${new Date(report.generated_at).toLocaleString()}`)
  lines.push(`**Environment:** ${report.environment}`)
  if (report.repo_sha) {
    lines.push(`**Git SHA:** ${report.repo_sha}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('> ⚠️ **Reports only.** No auto-deletion. Apply changes via PR.')
  lines.push('')

  // Static Report Summary
  if (report.static_report) {
    const sr = report.static_report
    lines.push('## Static Analysis Summary')
    lines.push('')
    lines.push('| Metric | Count |')
    lines.push('|--------|-------|')
    lines.push(`| Unused Files | ${sr.summary.unusedFilesCount} |`)
    lines.push(`| Unused Exports | ${sr.summary.unusedExportsCount} |`)
    lines.push(`| Unused Dependencies | ${sr.summary.unusedDepsCount} |`)
    lines.push(`| TypeScript Errors | ${sr.summary.tsErrorsCount} |`)
    lines.push(`| ESLint Warnings | ${sr.summary.eslintWarningsCount} |`)
    lines.push('')

    if (sr.unused_files.length > 0) {
      lines.push('### Unused Files')
      lines.push('')
      for (const file of sr.unused_files.slice(0, 20)) {
        lines.push(`- \`${file}\``)
      }
      if (sr.unused_files.length > 20) {
        lines.push(`- ... and ${sr.unused_files.length - 20} more`)
      }
      lines.push('')
    }

    if (sr.unused_deps.length > 0) {
      lines.push('### Unused Dependencies')
      lines.push('')
      for (const dep of sr.unused_deps) {
        lines.push(`- \`${dep}\``)
      }
      lines.push('')
    }
  }

  // Runtime Report Summary
  if (report.runtime_report) {
    const rr = report.runtime_report
    lines.push('## Runtime Usage Summary')
    lines.push('')
    lines.push(`**Range:** Last ${rr.range_days} days`)
    lines.push('')
    lines.push('| Metric | Count |')
    lines.push('|--------|-------|')
    lines.push(`| Total API Calls | ${rr.total_api_calls} |`)
    lines.push(`| Total RPC Calls | ${rr.total_rpc_calls} |`)
    lines.push(`| Total Page Views | ${rr.total_page_views} |`)
    lines.push('')

    if (rr.api_routes.length > 0) {
      lines.push('### Top API Routes')
      lines.push('')
      lines.push('| Route | Method | Hits | Last Seen |')
      lines.push('|-------|--------|------|-----------|')
      for (const route of rr.api_routes.slice(0, 10)) {
        lines.push(`| \`${route.route}\` | ${route.method} | ${route.hit_count} | ${new Date(route.last_seen).toLocaleDateString()} |`)
      }
      lines.push('')
    }
  }

  // Cleanup Plan
  if (report.cleanup_plan) {
    const cp = report.cleanup_plan
    lines.push('## Cleanup Plan')
    lines.push('')
    lines.push('### Summary')
    lines.push('')
    lines.push(`- **Safe to Remove:** ${cp.summary.safe_count} items`)
    lines.push(`- **Deprecate First:** ${cp.summary.deprecate_count} items`)
    lines.push(`- **Keep/Ignore:** ${cp.summary.keep_count} items`)
    lines.push('')

    if (cp.safe_to_remove.length > 0) {
      lines.push('### ✅ Safe to Remove (High Confidence)')
      lines.push('')
      lines.push('These items have high confidence of being unused and no recent runtime activity.')
      lines.push('')
      for (const item of cp.safe_to_remove.slice(0, 15)) {
        lines.push(`- [ ] \`${item.item.path}\`${item.item.name ? ` → ${item.item.name}` : ''}`)
        lines.push(`  - ${item.suggestedAction}`)
      }
      if (cp.safe_to_remove.length > 15) {
        lines.push(`- ... and ${cp.safe_to_remove.length - 15} more`)
      }
      lines.push('')
    }

    if (cp.deprecate_first.length > 0) {
      lines.push('### ⚠️ Deprecate First (Medium Confidence)')
      lines.push('')
      lines.push('These items should be deprecated and monitored before removal.')
      lines.push('')
      for (const item of cp.deprecate_first.slice(0, 15)) {
        lines.push(`- [ ] \`${item.item.path}\`${item.item.name ? ` → ${item.item.name}` : ''}`)
        lines.push(`  - ${item.suggestedAction}`)
      }
      if (cp.deprecate_first.length > 15) {
        lines.push(`- ... and ${cp.deprecate_first.length - 15} more`)
      }
      lines.push('')
    }

    if (cp.keep_or_ignore.length > 0) {
      lines.push('### 🔒 Keep / Ignore (Low Confidence)')
      lines.push('')
      lines.push('These items are likely dynamic routes or framework files.')
      lines.push('')
      for (const item of cp.keep_or_ignore.slice(0, 10)) {
        lines.push(`- \`${item.item.path}\` - ${item.item.reason}`)
      }
      if (cp.keep_or_ignore.length > 10) {
        lines.push(`- ... and ${cp.keep_or_ignore.length - 10} more`)
      }
      lines.push('')
    }
  }

  // Notes
  lines.push('---')
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  for (const note of report.metadata.notes) {
    lines.push(`- ${note}`)
  }
  lines.push('')
  lines.push(`*Generated by: ${report.metadata.generated_by}*`)

  return lines.join('\n')
}
