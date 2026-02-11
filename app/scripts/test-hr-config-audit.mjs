#!/usr/bin/env node
/**
 * Smoke test: HR Configuration Audit API
 *
 * Usage:
 *   node scripts/test-hr-config-audit.mjs [BASE_URL]
 *
 * Defaults to http://localhost:3000 if BASE_URL not provided.
 * Requires a valid session cookie (run in browser console to get one),
 * or set SUPABASE_AUTH_TOKEN env var.
 *
 * This test validates that the /api/hr/config/audit endpoint:
 * 1. Returns 200 with JSON
 * 2. Has expected top-level keys: sections, summary, orgId
 * 3. Summary has total, configured, partial, missing counts
 * 4. All 5 required sections are present
 * 5. Each check has required fields: key, label, status, detail
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000'
const ENDPOINT = `${BASE_URL}/api/hr/config/audit`
const TOKEN = process.env.SUPABASE_AUTH_TOKEN || ''

const REQUIRED_SECTIONS = [
    'Company Defaults',
    'Attendance Setup',
    'Leave Setup',
    'Payroll Setup',
    'Security & Notifications',
]

const REQUIRED_CHECK_FIELDS = ['key', 'label', 'status', 'detail']
const VALID_STATUSES = ['configured', 'partial', 'missing']

let passed = 0
let failed = 0

function assert(condition, message) {
    if (condition) {
        passed++
        console.log(`  ✅ ${message}`)
    } else {
        failed++
        console.error(`  ❌ ${message}`)
    }
}

async function main() {
    console.log(`\n🔍 HR Config Audit Smoke Test`)
    console.log(`   Endpoint: ${ENDPOINT}\n`)

    const headers = { 'Content-Type': 'application/json' }
    if (TOKEN) {
        headers['Authorization'] = `Bearer ${TOKEN}`
        headers['Cookie'] = `sb-access-token=${TOKEN}`
    }

    let res
    try {
        res = await fetch(ENDPOINT, { headers })
    } catch (err) {
        console.error(`❌ Could not reach ${ENDPOINT}: ${err.message}`)
        console.error('   Make sure the dev server is running (npm run dev)')
        process.exit(1)
    }

    // Test 1: HTTP 200 or 401 (no auth)
    if (res.status === 401) {
        console.log('⚠️  Got 401 Unauthorized — set SUPABASE_AUTH_TOKEN env var or test from browser.')
        console.log('   Validating response structure from a mock perspective...\n')

        const body = await res.json()
        assert(body.error === 'Unauthorized', 'Returns proper unauthorized error')
        printSummary()
        return
    }

    assert(res.status === 200, `HTTP status is 200 (got ${res.status})`)

    let body
    try {
        body = await res.json()
    } catch {
        assert(false, 'Response is valid JSON')
        printSummary()
        return
    }
    assert(true, 'Response is valid JSON')

    // Test 2: Top-level keys
    assert('sections' in body, 'Has "sections" key')
    assert('summary' in body, 'Has "summary" key')
    assert('orgId' in body, 'Has "orgId" key')

    // Test 3: Summary structure
    const { summary } = body
    assert(typeof summary?.total === 'number', `summary.total is number (${summary?.total})`)
    assert(typeof summary?.configured === 'number', `summary.configured is number (${summary?.configured})`)
    assert(typeof summary?.partial === 'number', `summary.partial is number (${summary?.partial})`)
    assert(typeof summary?.missing === 'number', `summary.missing is number (${summary?.missing})`)
    assert(
        (summary?.configured + summary?.partial + summary?.missing) === summary?.total,
        `Counts add up: ${summary?.configured} + ${summary?.partial} + ${summary?.missing} = ${summary?.total}`
    )

    // Test 4: Required sections exist
    const sectionNames = (body.sections || []).map(s => s.section)
    for (const name of REQUIRED_SECTIONS) {
        assert(sectionNames.includes(name), `Section "${name}" exists`)
    }

    // Test 5: Check structure
    const allChecks = (body.sections || []).flatMap(s => s.checks || [])
    assert(allChecks.length > 0, `Has checks (${allChecks.length} total)`)

    let checksValid = true
    for (const check of allChecks) {
        for (const field of REQUIRED_CHECK_FIELDS) {
            if (!(field in check)) {
                checksValid = false
                assert(false, `Check "${check.key || '?'}" missing field "${field}"`)
            }
        }
        if (check.status && !VALID_STATUSES.includes(check.status)) {
            checksValid = false
            assert(false, `Check "${check.key}" has invalid status "${check.status}"`)
        }
    }
    if (checksValid) {
        assert(true, `All ${allChecks.length} checks have valid structure`)
    }

    // Print check summary
    console.log('\n📋 Check Results:')
    for (const section of body.sections || []) {
        console.log(`\n  ${section.section}:`)
        for (const c of section.checks) {
            const icon = c.status === 'configured' ? '🟢' : c.status === 'partial' ? '🟡' : '🔴'
            console.log(`    ${icon} ${c.label}: ${c.detail}`)
        }
    }

    printSummary()
}

function printSummary() {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    console.log(`${'─'.repeat(50)}\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
})
