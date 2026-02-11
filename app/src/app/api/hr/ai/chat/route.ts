/**
 * POST /api/hr/ai/chat
 *
 * HR AI chat endpoint.  Validates session, fetches audit context,
 * sends to the selected AI provider via the AI Gateway.
 * If no provider is available, returns audit-based offline response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import { runHrAudit, buildAuditContextForAi } from '@/lib/ai/hrAudit'
import { sendToAi, buildOfflineResponse, HR_SYSTEM_INSTRUCTION } from '@/lib/ai/aiGateway'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import type { AiProvider, AiChatRequest } from '@/lib/ai/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

    // ── Auth ──────────────────────────────────────────────────────
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return NextResponse.json(
        { success: false, error: authResult.error ?? 'Unauthorized' },
        { status: 401 },
      )
    }

    const ctx = authResult.data
    const allowed = await canManageHr(ctx)
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 },
      )
    }

    if (!ctx.organizationId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 400 },
      )
    }

    // ── Parse body ───────────────────────────────────────────────
    const body = await request.json().catch(() => null)
    if (!body || typeof body.message !== 'string' || !body.message.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing "message" in request body' },
        { status: 400 },
      )
    }

    const userMessage: string = body.message.trim()
    const requestedProvider = body.provider as AiProvider | undefined
    const conversationHistory = body.history ?? []

    // ── Fetch audit context ──────────────────────────────────────
    const audit = await runHrAudit(supabase, ctx.organizationId)
    const auditContext = buildAuditContextForAi(audit)

    // ── Resolve provider config from DB → env fallback ────────────
    // If no explicit provider requested, check what's configured in DB
    const admin = createAdminClient()
    let resolvedConfig = await resolveProviderConfig(admin, ctx.organizationId, requestedProvider)

    // STRICT: No provider swapping. If admin selected Ollama in DB settings,
    // we use Ollama only. No fallback to OpenClaw (which costs money).

    const effectiveProvider = resolvedConfig.provider

    // ── Check provider availability ──────────────────────────────
    if (!resolvedConfig.enabled) {
      // Offline mode – return smart audit-based answer
      const offlineMsg = buildOfflineAnswer(userMessage, audit, auditContext)
      return NextResponse.json({
        success: true,
        data: buildOfflineResponse(offlineMsg),
        offline: true,
      })
    }

    // ── Send to AI ───────────────────────────────────────────────
    const aiRequest: AiChatRequest = {
      message: userMessage,
      context: {
        page: 'hr_home',
        orgId: ctx.organizationId,
        auditSummary: audit.summary,
        counts: {
          totalChecks: audit.summary.total,
          configured: audit.summary.configured,
          partial: audit.summary.partial,
          missing: audit.summary.missing,
          ...flattenCounts(auditContext),
        },
      },
      provider: effectiveProvider,
      systemInstruction: `${HR_SYSTEM_INSTRUCTION}\n\nCurrent HR audit context:\n${JSON.stringify(auditContext, null, 2)}`,
      conversationHistory,
    }

    const aiResponse = await sendToAi(aiRequest, {
      userId: ctx.userId,
      provider: effectiveProvider,
      configOverride: resolvedConfig,
    })

    // If AI errored, fall back to offline answer
    if (aiResponse.error && !aiResponse.message) {
      const offlineMsg = buildOfflineAnswer(userMessage, audit, auditContext)
      return NextResponse.json({
        success: true,
        data: {
          ...buildOfflineResponse(offlineMsg),
          error: aiResponse.error,
        },
        offline: true,
      })
    }

    return NextResponse.json({ success: true, data: aiResponse })
  } catch (err: any) {
    console.error('[HR AI Chat] Error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ─── Offline answer builder ────────────────────────────────────────

function buildOfflineAnswer(
  message: string,
  audit: ReturnType<typeof runHrAudit> extends Promise<infer T> ? T : never,
  _context: Record<string, any>,
): string {
  const msg = message.toLowerCase()
  const { summary, sections } = audit

  if (msg.includes('ready') || msg.includes('configuration') || msg.includes('audit')) {
    const lines = [
      `**HR Configuration Audit** (${summary.configured}/${summary.total} checks passed)\n`,
    ]
    for (const section of sections) {
      const icon = section.status === 'configured' ? '✅' : section.status === 'partial' ? '⚠️' : '❌'
      lines.push(`${icon} **${section.label}**: ${section.status}`)
      for (const check of section.checks) {
        if (check.status !== 'configured') {
          lines.push(`   - ${check.label}: ${check.detail}`)
        }
      }
    }
    lines.push('\n*AI provider is offline. This data is from direct database audit.*')
    return lines.join('\n')
  }

  if (msg.includes('payroll')) {
    const payroll = sections.find((s) => s.key === 'payroll_setup')
    if (!payroll) return 'Payroll section not found in audit.'
    const issues = payroll.checks.filter((c) => c.status !== 'configured')
    if (issues.length === 0) return '✅ Payroll configuration looks complete!'
    return `**Payroll Issues (${issues.length}):**\n${issues.map((i) => `- ${i.label}: ${i.detail}`).join('\n')}`
  }

  if (msg.includes('manager') || msg.includes('position')) {
    const org = sections.find((s) => s.key === 'org_structure')
    if (!org) return 'Org structure section not found in audit.'
    const relevant = org.checks.filter((c) =>
      c.key.includes('manager') || c.key.includes('position'),
    )
    return relevant.map((c) => {
      const icon = c.status === 'configured' ? '✅' : '⚠️'
      return `${icon} ${c.label}: ${c.detail}`
    }).join('\n')
  }

  if (msg.includes('leave') || msg.includes('approval')) {
    const leave = sections.find((s) => s.key === 'leave_setup')
    if (!leave) return 'Leave section not found in audit.'
    return leave.checks.map((c) => {
      const icon = c.status === 'configured' ? '✅' : c.status === 'partial' ? '⚠️' : '❌'
      return `${icon} ${c.label}: ${c.detail}`
    }).join('\n')
  }

  if (msg.includes('critical') || msg.includes('issue') || msg.includes('missing') || msg.includes('problem')) {
    const missing = sections.flatMap((s) => s.checks).filter((c) => c.status === 'missing')
    if (missing.length === 0) return '✅ No critical issues found! All configuration checks passed.'
    return `**Critical Issues (${missing.length}):**\n${missing.map((c) => `❌ ${c.label}: ${c.detail}`).join('\n')}`
  }

  // Default: show summary
  return [
    `**HR Audit Summary:** ${summary.configured}/${summary.total} configured, ${summary.partial} partial, ${summary.missing} missing.`,
    '',
    'Try asking:',
    '- "Is HR configuration ready?"',
    '- "What is missing before we run payroll?"',
    '- "Any employees missing manager/position?"',
    '- "Is leave approval flow configured?"',
    '- "Show me all critical issues"',
    '',
    '*AI provider is offline. Responses are based on direct database audit.*',
  ].join('\n')
}

function flattenCounts(ctx: Record<string, any>): Record<string, number | boolean | string> {
  const flat: Record<string, number | boolean | string> = {}
  if (ctx.sections && Array.isArray(ctx.sections)) {
    for (const section of ctx.sections) {
      flat[`${section.label}_status`] = section.status
      flat[`${section.label}_issues`] = section.issues?.length ?? 0
    }
  }
  return flat
}
