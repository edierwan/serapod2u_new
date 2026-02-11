/**
 * Smoke test script for HR AI Assistant API endpoints
 *
 * Usage:
 *   npx tsx scripts/test-hr-ai.ts
 *
 * Requires a running dev server on localhost:3000 and valid session cookies.
 * For quick manual testing, copy your browser session cookie.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const COOKIE = process.env.SESSION_COOKIE || '' // paste sb-xxx-auth-token cookie

async function fetchApi(path: string, options: RequestInit = {}) {
  const url = `${BASE}${path}`
  console.log(`\n→ ${options.method || 'GET'} ${url}`)

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: COOKIE,
      ...options.headers,
    },
  })

  const json = await res.json()
  console.log(`  Status: ${res.status}`)
  console.log(`  Response:`, JSON.stringify(json, null, 2).slice(0, 500))
  return { status: res.status, json }
}

async function main() {
  console.log('=== HR AI Assistant – Smoke Tests ===')
  console.log(`Base: ${BASE}`)
  console.log(`Cookie: ${COOKIE ? '(set)' : '(not set – will likely get 401)'}`)

  // 1. Test Audit endpoint
  console.log('\n\n--- Test 1: GET /api/hr/ai/audit ---')
  const audit = await fetchApi('/api/hr/ai/audit')

  if (audit.json.success) {
    const { summary, sections } = audit.json.data
    console.log(`  ✅ Audit passed: ${summary.configured}/${summary.total} configured`)
    console.log(`     Sections: ${sections.map((s: any) => `${s.label}(${s.status})`).join(', ')}`)
  } else {
    console.log(`  ❌ Audit failed: ${audit.json.error}`)
  }

  // 2. Test Chat endpoint
  console.log('\n\n--- Test 2: POST /api/hr/ai/chat ---')
  const chat = await fetchApi('/api/hr/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'Is HR configuration ready?' }),
  })

  if (chat.json.success) {
    console.log(`  ✅ Chat response (${chat.json.offline ? 'OFFLINE' : chat.json.data?.provider}):`)
    console.log(`     ${(chat.json.data?.message || '').slice(0, 200)}...`)
  } else {
    console.log(`  ❌ Chat failed: ${chat.json.error}`)
  }

  // 3. Test Chat – payroll question
  console.log('\n\n--- Test 3: POST /api/hr/ai/chat (payroll) ---')
  const payroll = await fetchApi('/api/hr/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'What is missing before we run payroll?' }),
  })

  if (payroll.json.success) {
    console.log(`  ✅ Payroll check: ${(payroll.json.data?.message || '').slice(0, 200)}...`)
  }

  // 4. Test Actions – without confirmation (should fail)
  console.log('\n\n--- Test 4: POST /api/hr/ai/actions/define_leave_types (no confirm) ---')
  const noConfirm = await fetchApi('/api/hr/ai/actions/define_leave_types', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  console.log(`  Expected 400: ${noConfirm.status === 400 ? '✅' : '❌'} (got ${noConfirm.status})`)

  // 5. Test Actions – unknown action
  console.log('\n\n--- Test 5: POST /api/hr/ai/actions/unknown_action ---')
  const unknown = await fetchApi('/api/hr/ai/actions/unknown_action', {
    method: 'POST',
    body: JSON.stringify({ confirmation: true }),
  })
  console.log(`  Expected 404: ${unknown.status === 404 ? '✅' : '❌'} (got ${unknown.status})`)

  console.log('\n\n=== Smoke tests complete ===')
}

main().catch(console.error)
