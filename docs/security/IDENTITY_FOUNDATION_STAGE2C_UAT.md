# Identity Foundation Stage 2C — staging UAT

Build under test: staging `2ff48b44`, which contains the 2C commits `54cd532b` and `3b7dd218`.
Modes are unchanged, no migration was run, and production is not touched.

The UAT has three parts:

| Part | Who | What |
|---|---|---|
| A | Claude (read-only) | Decision matrix, `supabase/diagnostics/identity_stage2c_staging_uat.sql`: the exact S&A question each converted decision now asks, for real users of every role@org-type, compared with the old rule |
| B | Management (signed in) | Browser-console probes and UI steps below. Each step is side-effect-free, reverted, or a denial |
| C | Claude (read-only) | Decision-log and log verification for Part B, plus the loyalty/consumer regression check |

## Part B — signed-in steps

Note the UTC time before you start, and use two browser profiles:

- **SA**: your Super Admin account.
- **QA-E**: `qa-idf2-260929002356-e`, a staff identity with the no-authority baseline only.

### B1 — console probes (run as SA, then again as QA-E)

1. Open `https://stg.serapod2u.com/dashboard`.
2. Open DevTools → Console and paste the script below.
3. Copy the printed table and send it back.

The script only makes these calls:

- two HR "employment type" saves of the value each user already has;
- requests for a random, non-existent organization, journey, review and shipment session;
- read-only admin reports;
- one bulk-delete request that contains only your own id, which every version of the route refuses.

It does not export data, run migrations or confirm shipments.

```js
(async () => {
  const DIST_USER = '5811dba4-67d3-477e-a03f-8948db95000c'     // portal user in a DIST org under HQ (employment type: none)
  const UNRELATED_USER = 'a5dacf58-3a44-46dd-9e2d-cd5abca71dcd' // user in the MFG org that has no parent (employment type: none)
  const rnd = () => crypto.randomUUID()
  const me = await fetch('/api/user/profile').then(r => r.json()).catch(() => ({}))
  const self = me?.data?.id ?? me?.profile?.id ?? me?.user?.id ?? me?.id
  const call = async (id, method, url, body, form) => {
    const init = { method, headers: form ? undefined : { 'Content-Type': 'application/json' } }
    if (form) { const f = new FormData(); Object.entries(body).forEach(([k, v]) => f.append(k, v)); init.body = f }
    else if (body !== undefined) init.body = JSON.stringify(body)
    const r = await fetch(url, init)
    const text = await r.text()
    const msg = (text.match(/"(?:error|message)"\s*:\s*"([^"]{0,70})/) || [])[1] || ''
    return { id, status: r.status, msg }
  }
  const rows = []
  rows.push(await call('B1.1 HR cross-org, descendant DIST org', 'PATCH', `/api/users/${DIST_USER}/hr`, { employment_type: null }))
  rows.push(await call('B1.2 HR cross-org, unrelated MFG org', 'PATCH', `/api/users/${UNRELATED_USER}/hr`, { employment_type: null }))
  rows.push(await call('B1.3 org delete: request OTP (unknown org)', 'POST', '/api/organizations/delete/request-otp', { orgId: rnd() }))
  rows.push(await call('B1.4 org delete: verify (unknown code)', 'POST', '/api/organizations/delete/verify-and-delete', { orgId: rnd(), code: '000000', codeId: rnd() }))
  rows.push(await call('B1.5 org import: preview without file', 'POST', '/api/organizations/import', { action: 'preview' }, true))
  rows.push(await call('B1.6 journey update (unknown journey)', 'PATCH', '/api/journey/update', { id: rnd() }))
  rows.push(await call('B1.7 KPI request-changes (unknown review)', 'POST', `/api/hr/kpi/reviews/${rnd()}/request-changes`, {}))
  rows.push(await call('B1.8 confirm-shipment (unknown session)', 'POST', '/api/warehouse/confirm-shipment', { session_id: rnd() }))
  rows.push(await call('B1.9 restore-data (empty backup)', 'POST', '/api/admin/restore-data', {}))
  rows.push(await call('B1.10 send-deletion-notification (empty)', 'POST', '/api/admin/send-deletion-notification', {}))
  rows.push(await call('B1.11 cleanup runtime report (read-only)', 'GET', '/api/admin/cleanup/runtime-report?range=1'))
  rows.push(await call('B1.12 admin states (read-only)', 'GET', '/api/admin/states'))
  rows.push(await call('B1.13 fix-shop-rls (returns SQL text only)', 'POST', '/api/admin/fix-shop-rls', {}))
  rows.push(self
    ? await call('B1.14 bulk-delete: only my own id, no callerId', 'POST', '/api/admin/bulk-delete-users', { userIds: [self] })
    : { id: 'B1.14 bulk-delete', status: 'skipped', msg: 'own id not found' })
  console.table(rows)
})()
```

Expected results:

| Probe | SA | QA-E |
|---|---|---|
| B1.1 descendant DIST org | 200 (S&A reaches the DIST org through the HQ scope) | 403 |
| B1.2 unrelated MFG org | 403 `Unauthorized`. This is the intended 2C change: the old rule let role_level ≤ 20 edit any org; S&A reaches only descendants | 403 |
| B1.3 request OTP | 404 `Organization not found` (authorized, then no such org) | 403 |
| B1.4 verify-and-delete | 400 invalid or expired code | 403 |
| B1.5 import preview | 400 `No file uploaded` | 403 |
| B1.6 journey update | not 401/403 (400/404/500 on the unknown id) | 403 |
| B1.7 KPI request-changes | not 403 (the unknown id fails after authorization) | 403 |
| B1.8 confirm-shipment | 404 `Shipment session not found` | 403 |
| B1.9 restore-data | 400 `Invalid backup file format` | 403 |
| B1.10 deletion notification | 400 missing fields | 403 |
| B1.11 runtime report | 200 | 403 |
| B1.12 states | 200 | 403 |
| B1.13 fix-shop-rls | 200 (SQL text only; nothing is executed) | 403 |
| B1.14 bulk-delete | 403 `Destructive operations are disabled in this environment` | same |

B1.14 cannot reach the 2C code on staging. Staging runs with
`NODE_ENV=production` and without `ALLOW_DESTRUCTIVE_DB_OPS`, so the
environment gate refuses every caller first. The verified-session fix is
covered by code review and the contract test. Proving it live needs that flag
to be switched on temporarily, and that is a management decision. If it ever
is, the same probe must end with `No users to delete (cannot delete
yourself)`; the pre-2C code would stop at `Caller ID required`.

### B2 — UI steps as SA (revert each change)

1. **HR → Departments**: open any department, change its description, save, then change it back.
2. **HR → Positions**: edit a position name, save, then change it back.
3. **HR → Settings**: save without changes.
4. **HR → Accounting (GL mappings)**: re-save one mapping with the account it already has.
5. **HR Assistant**: ask for the basic salary of an employee in your organization. Expect an answer that includes salary (HR manager tier).

### B3 — UI steps as QA-E

1. **HR Assistant**: ask the same salary question. Expect no salary, bank or IC data.

### B4 — loyalty / consumer regression, as the consumer QA-H (`qa-idf-260928151804-h`) or any staging consumer

1. Sign in to the consumer app.
2. Open the points balance and points history.
3. Open the rewards catalogue.
4. Open the shop-link screen (no need to submit).

All screens should load as before.

### B5 — optional, warehouse staff

Confirm a staging test shipment through the normal warehouse flow. Six sessions
are pending on staging. This exercises the new warehouse-context check on a
real session. Only do it if the warehouse team is happy for staging stock to
move.

## Part C — verification (Claude)

After Part B, Claude runs `identity_stage2c_uat_verify.sql` (read-only) from the
start time you give. It checks:

- `sa_authorization_decisions` rows per permission and resource type (`hr_employee`,
  `hr_settings`, `hr_organization`, `finance_company`, `warehouse_shipment`,
  `customer_campaign`, `platform_data`, `platform_settings`,
  `platform_organization`), each with decision, legacy decision and comparison:
  - every QA-E row is DENY;
  - every SA row matches the table above;
- no new 5xx or database errors from the 2C routes;
- the loyalty/consumer tables and endpoints: no errors, and no consumer
  decisions in S&A;
- the identity invariants from the Stage 2 UAT: unchanged.
