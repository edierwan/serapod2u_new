import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import type {
  StaticReport,
  StaticReportSummary,
  UnusedExport,
  TypeScriptError,
  ESLintWarning,
  GenerateStaticReportResponse,
  KNOWN_FALSE_POSITIVES,
} from '@/types/cleanup'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // 2 minutes for analysis

/**
 * POST /api/admin/cleanup/static-report
 * Generate a static analysis report using knip, tsc, and eslint
 * SUPER ADMIN ONLY (role_level = 1)
 * 
 * This runs in SAFE MODE:
 * - No autofix
 * - No deletions
 * - Report only
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
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
      .select('id, role_code, roles(role_level)')
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
    const includeKnip = body.include_knip !== false
    const includeTsc = body.include_tsc !== false
    const includeEslint = body.include_eslint !== false

    // Determine project root
    const projectRoot = process.cwd()
    
    // Initialize report structure
    const report: StaticReport = {
      generated_at: new Date().toISOString(),
      repo_sha: await getGitSha(projectRoot),
      environment: detectEnvironment(),
      summary: {
        unusedFilesCount: 0,
        unusedExportsCount: 0,
        unusedDepsCount: 0,
        tsErrorsCount: 0,
        eslintWarningsCount: 0,
      },
      unused_files: [],
      unused_exports: [],
      unused_deps: [],
      ts_errors: [],
      eslint_warnings: [],
      notes: [],
    }

    // Run analyses in parallel where possible
    const analyses: Promise<void>[] = []

    if (includeKnip) {
      analyses.push(runKnipAnalysis(projectRoot, report))
    }

    if (includeTsc) {
      analyses.push(runTypeScriptAnalysis(projectRoot, report))
    }

    if (includeEslint) {
      analyses.push(runESLintAnalysis(projectRoot, report))
    }

    await Promise.allSettled(analyses)

    // Update summary counts
    report.summary.unusedFilesCount = report.unused_files.length
    report.summary.unusedExportsCount = report.unused_exports.length
    report.summary.unusedDepsCount = report.unused_deps.length
    report.summary.tsErrorsCount = report.ts_errors.length
    report.summary.eslintWarningsCount = report.eslint_warnings.length

    // Sanitize paths to remove sensitive information
    sanitizePaths(report, projectRoot)

    const executionTime = Date.now() - startTime

    const response: GenerateStaticReportResponse = {
      success: true,
      report,
      execution_time_ms: executionTime,
    }

    return NextResponse.json(response)

  } catch (error: any) {
    console.error('Static report generation error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to generate static report',
      execution_time_ms: Date.now() - startTime,
    } as GenerateStaticReportResponse, { status: 500 })
  }
}

/**
 * Get current git SHA
 */
async function getGitSha(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd: projectRoot })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Detect current environment
 */
function detectEnvironment(): 'local' | 'ci' | 'production' {
  if (process.env.CI) return 'ci'
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV?.includes('preview')) {
    return 'production'
  }
  return 'local'
}

/**
 * Run Knip analysis for unused exports/files/dependencies
 */
async function runKnipAnalysis(projectRoot: string, report: StaticReport): Promise<void> {
  try {
    // Check if knip is available
    const knipPath = path.join(projectRoot, 'node_modules', '.bin', 'knip')
    
    try {
      await fs.access(knipPath)
    } catch {
      report.notes.push('Knip not installed. Run: npm install -D knip')
      return
    }

    // Run knip with JSON reporter (safe mode, no fixes)
    const { stdout, stderr } = await execAsync(
      'npx knip --reporter json 2>/dev/null || true',
      { 
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 90000, // 90 seconds
      }
    )

    if (!stdout.trim()) {
      report.notes.push('Knip analysis completed with no issues found.')
      return
    }

    // Parse Knip JSON output
    const knipResult = JSON.parse(stdout)

    // Process unused files
    if (knipResult.files && Array.isArray(knipResult.files)) {
      report.unused_files = knipResult.files.map((f: any) => 
        typeof f === 'string' ? f : f.name || f.path
      )
    }

    // Process unused exports
    if (knipResult.exports && Array.isArray(knipResult.exports)) {
      report.unused_exports = knipResult.exports.map((e: any) => ({
        file: e.file || e.name || 'unknown',
        exportName: e.symbol || e.export || e.name || 'unknown',
        type: detectExportType(e.symbol || e.export || ''),
      }))
    }

    // Process unused dependencies
    if (knipResult.dependencies && Array.isArray(knipResult.dependencies)) {
      report.unused_deps = knipResult.dependencies.map((d: any) =>
        typeof d === 'string' ? d : d.name || d.package
      )
    }

    // Also check devDependencies
    if (knipResult.devDependencies && Array.isArray(knipResult.devDependencies)) {
      const devDeps = knipResult.devDependencies.map((d: any) =>
        typeof d === 'string' ? d : d.name || d.package
      )
      report.unused_deps = [...report.unused_deps, ...devDeps.map((d: string) => `(dev) ${d}`)]
    }

    report.notes.push('Knip analysis completed successfully.')

  } catch (error: any) {
    report.notes.push(`Knip analysis error: ${error.message}`)
  }
}

/**
 * Run TypeScript compiler check (no emit)
 */
async function runTypeScriptAnalysis(projectRoot: string, report: StaticReport): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx tsc --noEmit --pretty false 2>&1 || true',
      {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90000,
      }
    )

    const output = stdout + stderr
    if (!output.trim()) {
      report.notes.push('TypeScript check completed with no errors.')
      return
    }

    // Parse TypeScript errors (format: file(line,col): error TSxxxx: message)
    const tsErrorRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm
    let match

    while ((match = tsErrorRegex.exec(output)) !== null) {
      report.ts_errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6],
      })
    }

    report.notes.push(`TypeScript analysis found ${report.ts_errors.length} issues.`)

  } catch (error: any) {
    report.notes.push(`TypeScript analysis error: ${error.message}`)
  }
}

/**
 * Run ESLint analysis (no fix)
 */
async function runESLintAnalysis(projectRoot: string, report: StaticReport): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx eslint . --format json --no-fix --max-warnings -1 2>/dev/null || true',
      {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90000,
      }
    )

    if (!stdout.trim()) {
      report.notes.push('ESLint analysis completed with no warnings.')
      return
    }

    const eslintResult = JSON.parse(stdout)

    for (const file of eslintResult) {
      if (!file.messages || file.messages.length === 0) continue

      for (const msg of file.messages) {
        // Only include unused vars/imports warnings
        if (msg.ruleId?.includes('unused') || 
            msg.ruleId?.includes('no-unused') ||
            msg.ruleId === '@typescript-eslint/no-unused-vars') {
          report.eslint_warnings.push({
            file: file.filePath,
            line: msg.line || 0,
            column: msg.column || 0,
            rule: msg.ruleId || 'unknown',
            message: msg.message,
            severity: msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info',
          })
        }
      }
    }

    report.notes.push(`ESLint analysis found ${report.eslint_warnings.length} unused var/import warnings.`)

  } catch (error: any) {
    report.notes.push(`ESLint analysis error: ${error.message}`)
  }
}

/**
 * Detect export type from name
 */
function detectExportType(name: string): UnusedExport['type'] {
  if (name.startsWith('I') && name[1] === name[1]?.toUpperCase()) return 'interface'
  if (name.startsWith('T') && name[1] === name[1]?.toUpperCase()) return 'type'
  if (name.startsWith('E') && name[1] === name[1]?.toUpperCase()) return 'enum'
  if (name[0] === name[0]?.toUpperCase()) return 'class'
  if (name.includes('function') || name.includes('Function')) return 'function'
  return 'unknown'
}

/**
 * Sanitize paths to remove sensitive project root information
 */
function sanitizePaths(report: StaticReport, projectRoot: string): void {
  const sanitize = (p: string) => p.replace(projectRoot, '').replace(/^\//, '')

  report.unused_files = report.unused_files.map(sanitize)
  report.unused_exports = report.unused_exports.map(e => ({
    ...e,
    file: sanitize(e.file),
  }))
  report.ts_errors = report.ts_errors.map(e => ({
    ...e,
    file: sanitize(e.file),
  }))
  report.eslint_warnings = report.eslint_warnings.map(w => ({
    ...w,
    file: sanitize(w.file),
  }))
}
